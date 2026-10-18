# dsh-mcp-catalog

DSH Web 的 **MCP 目录面板**：左侧边栏一个入口，点开就能看到每个 MCP 提供方、它们提供的工具（**接口名 + 作用**），
桥类提供方（如钉钉桥）还能继续展开到**真实上游服务器与真实工具**。

只读面板：不调用工具、不改配置、不写任何 dsh 状态。

## 交互结构

```
侧边栏「MCP」
└─ 提供方列表（每个提供方可展开）
   ├─ 普通提供方：直接列出工具名 + 作用（+ 参数个数 / 必填个数）
   └─ 桥类提供方（带「桥」标记，默认 ding）
      ├─ 元工具（ding_servers / ding_search / ding_describe / ding_call）—— 下钻通道
      └─ 真实上游服务（aitable / dingbot / dingcal / dingcontact / dingdoc / dingsheet / dingtodo）
         └─ 每个上游可再展开，列出该上游的真实工具名 + 作用
```

顶部有搜索框（按工具名或作用过滤，命中时自动展开所在提供方）与「刷新」按钮。

## 数据来源（Host 半侧，私有 RPC 通道 `/dsh-mcp-catalog`）

| 端点 | 内容 | 来源 |
|---|---|---|
| `inventory` | 提供方 → 工具（name / description / 参数数 / 必填数） | `ctx.tools.schemas()` 按注册名 `mcp__<server>__<tool>` 分组 |
| `nested` | 桥的元工具 + 7 台真实上游及其工具 | 拉起桥进程，调 `<nestedServer>_search{query:"", connect:true}`；结果按 `cacheTtlMs` 缓存 |
| `refresh` | 清缓存 | — |

`nested` 在**展开桥提供方时才触发**，并且用独立的一次性子进程（读完即退出），不影响 dsh 自己那份桥连接。

## 配置项（Config schema 默认值）

| 字段 | 默认 | 说明 |
|---|---|---|
| `nestedServer` | `ding` | 当作「桥」处理的 MCP 服务器名 |
| `bridgeCommand` | `node` | 桥进程可执行文件 |
| `bridgeArgs` | `['/Users/xt03375/.dsh/bridges/ding-bridge/bridge.mjs']` | 桥进程参数 |
| `callTimeoutMs` | `90000` | 桥进程单次请求超时 |
| `cacheTtlMs` | `300000` | 上游目录缓存时长 |

## 安装与启用

已安装进 web profile：`package.json` 的 `dependencies` 与 `dsh.profile.bundles` 均含 `dsh-mcp-catalog`。
**挂载需要重启一次 `dsh web`**（bundle 层只在启动时组合）。

源码目录已加入 profile patch 的 `hmr.root`，重启之后改 `client.js` / `index.mjs` 会热替换，不必再重启。

## 验证

1. 重启 `dsh web`，刷新页面 → 左侧出现「MCP」入口
2. 点开 → 应看到 5 个提供方：`ding`、`intellij-index`、`openviking`、`qwennote`、`xt-api-docs`
3. 展开 `ding` → 先加载上游（首次约 2s）→ 出现 4 个元工具 + 7 台上游，逐台展开可见 367 个真实工具
4. 搜索框输入 `order` / `表格` 等 → 命中项自动展开

Host 半侧已用真实桥离线验证：`groupMcpSchemas` 分组正确、`enumerateNested` 返回 4 元工具 + 7 上游 / 367 工具、
`inventory` / `nested`（含缓存命中）/ `ping` / 未知端点错误分支均符合预期。

## 已知边界

- `inventory` 取自部署全局的工具注册面，**不含** preset 级 `tools.restrict` 的 per-agent 差异；面板是全局目录，不是某个会话的可见集。
- 上游枚举会临时连接 7 台钉钉 MCP（只读 `tools/list`），结果按 TTL 缓存；点「刷新」会强制重取。
- 面板只读：不能在 UI 里试调用工具（如需，可作为下一步加一个「以 JSON 参数试调用」的只读-确认区）。