/**
 * dsh-mcp-catalog — Host half.
 *
 * Serves a read-only MCP catalog to the web client over a private RPC channel
 * (`/dsh-mcp-catalog`). Two layers:
 *
 *   1. `inventory` — every MCP provider visible in the tool registry, grouped by
 *      the `mcp__<server>__<tool>` registration name, with each tool's name and
 *      description (i.e. 接口 + 作用). Source: `ctx.tools.schemas()`.
 *   2. `nested` — for a *bridge* provider (one whose own surface is a handful of
 *      meta tools), spawn the bridge over stdio and read its upstream catalog
 *      (`<server>_search` with an empty query), so the panel can expand
 *      provider → meta tools → real upstream servers → their real tools.
 *
 * Nothing here mutates state: the panel is a viewer. Upstream enumeration runs in
 * a short-lived child process and is cached for `cacheTtlMs`.
 */
import z from '@deepseek-ai/schemastery';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export const name = 'dsh-mcp-catalog';

/** Private Host RPC channel (never the shared `/api`). */
const CHANNEL = '/dsh-mcp-catalog';
const MCP_PREFIX = 'mcp__';
const PROTOCOL_VERSION = '2025-06-18';

export const Config = z
  .object({
    nestedServer: z
      .string()
      .default('ding')
      .description('当作「桥」处理的 MCP 服务器名；其 <name>_search / <name>_servers 元工具用于下钻到真实上游。'),
    bridgeCommand: z.string().default('node').description('桥进程的可执行文件。'),
    bridgeArgs: z
      .array(z.string())
      .default(['/Users/xt03375/.dsh/bridges/ding-bridge/bridge.mjs'])
      .description('桥进程的参数（钉钉桥默认路径）。'),
    callTimeoutMs: z.number().default(90000).description('桥进程单次请求超时（毫秒）。'),
    cacheTtlMs: z.number().default(300000).description('上游目录缓存时长（毫秒）。'),
  })
  .description('MCP 目录面板：展示各 MCP 提供方的工具清单，并支持对桥类服务器下钻到真实上游工具。');

/* ────────────────────────────── catalog grouping ────────────────────────────── */

/**
 * Group model-facing tool schemas by their MCP provider.
 * @param {Array<{name?: string, description?: string, parameters?: unknown}>} schemas
 * @returns {Array<{server: string, tools: Array<{name: string, description: string, parameterCount: number}>}>}
 */
export function groupMcpSchemas(schemas) {
  const servers = new Map();
  for (const schema of Array.isArray(schemas) ? schemas : []) {
    const full = typeof schema?.name === 'string' ? schema.name : '';
    if (!full.startsWith(MCP_PREFIX)) continue;
    const rest = full.slice(MCP_PREFIX.length);
    const sep = rest.indexOf('__');
    if (sep <= 0) continue;
    const server = rest.slice(0, sep);
    const tool = rest.slice(sep + 2);
    if (!server || !tool) continue;
    if (!servers.has(server)) servers.set(server, { server, tools: [] });
    const parameters = schema.parameters && typeof schema.parameters === 'object' ? schema.parameters : {};
    const properties = parameters.properties && typeof parameters.properties === 'object' ? parameters.properties : {};
    servers.get(server).tools.push({
      name: tool,
      description: typeof schema.description === 'string' ? schema.description : '',
      parameterCount: Object.keys(properties).length,
      required: Array.isArray(parameters.required) ? parameters.required.length : 0,
    });
  }
  return [...servers.values()]
    .map((entry) => ({ ...entry, tools: entry.tools.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.server.localeCompare(b.server));
}

/* ───────────────────────── stdio MCP client (minimal) ───────────────────────── */

/**
 * Start a stdio MCP server and expose request/notify/close.
 * @param {{command: string, args: string[], timeoutMs: number}} options
 */
function startStdioClient({ command, args, timeoutMs }) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let nextId = 1;
  let closed = false;
  let stderrTail = '';

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.id === undefined || message.id === null) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message ?? 'bridge error'));
    else entry.resolve(message.result);
  });
  child.on('error', (error) => {
    for (const [, entry] of pending) entry.reject(error);
    pending.clear();
  });
  child.stderr?.on('data', (chunk) => {
    stderrTail = `${stderrTail}${chunk.toString()}`.slice(-2000);
  });
  child.on('close', () => {
    closed = true;
    for (const [, entry] of pending) entry.reject(new Error('bridge process exited'));
    pending.clear();
  });

  const request = (method, params) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error(`bridge process is not running${stderrTail ? `: ${stderrTail}` : ''}`));
        return;
      }
      const id = nextId++;
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`bridge ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });

  return {
    request,
    notify: (method, params) => {
      if (!closed) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    close: () => {
      closed = true;
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    },
  };
}

/* ────────────────────────── nested (bridge) enumeration ─────────────────────── */

/**
 * Read a bridge's real upstream catalog by driving its own meta tools.
 * @param {{nestedServer: string, bridgeCommand: string, bridgeArgs: string[], callTimeoutMs: number}} cfg
 */
export async function enumerateNested(cfg) {
  const prefix = cfg.nestedServer;
  const client = startStdioClient({
    command: cfg.bridgeCommand,
    args: cfg.bridgeArgs,
    timeoutMs: cfg.callTimeoutMs,
  });
  try {
    await client.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'dsh-mcp-catalog', version: '0.1.0' },
    });
    client.notify('notifications/initialized', {});
    const listed = await client.request('tools/list', {});
    const metaTools = Array.isArray(listed?.tools)
      ? listed.tools.map((tool) => ({
          name: tool.name,
          description: typeof tool.description === 'string' ? tool.description : '',
        }))
      : [];
    const searchTool = `${prefix}_search`;
    if (!metaTools.some((tool) => tool.name === searchTool)) {
      return {
        available: false,
        server: prefix,
        metaTools,
        reason: `桥未暴露 ${searchTool}，无法枚举上游；请核对 nestedServer 配置`,
        upstreams: [],
      };
    }
    const called = await client.request('tools/call', {
      name: searchTool,
      arguments: { query: '', connect: true, limit: 1000 },
    });
    const text = Array.isArray(called?.content)
      ? called.content.find((block) => block?.type === 'text')?.text ?? ''
      : '';
    const parsed = text ? JSON.parse(text) : {};
    const byServer = parsed?.byServer && typeof parsed.byServer === 'object' ? parsed.byServer : {};
    const upstreams = Object.entries(byServer)
      .map(([server, tools]) => ({
        server,
        toolCount: Array.isArray(tools) ? tools.length : 0,
        tools: (Array.isArray(tools) ? tools : []).map((tool) => ({
          name: String(tool?.name ?? ''),
          description: typeof tool?.description === 'string' ? tool.description : '',
        })),
      }))
      .sort((a, b) => a.server.localeCompare(b.server));
    return {
      available: true,
      server: prefix,
      metaTools,
      upstreams,
      failed: Array.isArray(parsed?.failed) ? parsed.failed : [],
      generatedAt: Date.now(),
    };
  } finally {
    client.close();
  }
}

/* ──────────────────────────────── RPC handler ──────────────────────────────── */

/**
 * @param {() => any} getTools   the host tool registry (`ctx.tools`)
 * @param {() => any} getConfig  resolved plugin config
 */
export function createHandler(getTools, getConfig) {
  let cache = { at: 0, value: null };
  return async (endpoint, payload) => {
    try {
      switch (endpoint) {
        case 'ping':
          return { ok: true, value: { ok: true, pong: true } };

        case 'inventory': {
          const cfg = getConfig();
          const tools = getTools();
          const schemas = tools && typeof tools.schemas === 'function' ? tools.schemas() : [];
          return {
            ok: true,
            value: {
              nestedServer: cfg.nestedServer,
              generatedAt: Date.now(),
              providers: groupMcpSchemas(schemas),
            },
          };
        }

        case 'nested': {
          const cfg = getConfig();
          const fresh = payload?.refresh === true;
          if (!fresh && cache.value && Date.now() - cache.at < cfg.cacheTtlMs) {
            return { ok: true, value: { ...cache.value, cached: true } };
          }
          const value = await enumerateNested(cfg);
          cache = { at: Date.now(), value };
          return { ok: true, value };
        }

        case 'refresh':
          cache = { at: 0, value: null };
          return { ok: true, value: { ok: true } };

        default:
          return { ok: false, error: { code: 'unknown-endpoint', message: `unknown endpoint ${String(endpoint)}`, details: {} } };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: { code: 'failed', message: message.slice(0, 500), details: {} } };
    }
  };
}

/* ──────────────────────────────── plugin mount ──────────────────────────────── */

export function apply(ctx, config) {
  const getConfig = () => (config ? { ...Config({}), ...config } : Config({}));
  ctx.inject(['connection', 'tools'], (scope) => {
    const connection = scope.root.connection;
    const tools = scope.root.tools;
    scope.effect(
      () => connection.rpc.handle(CHANNEL, createHandler(() => tools, getConfig)),
      'dsh-mcp-catalog: RPC channel',
    );
  });
}