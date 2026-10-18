/**
 * dsh-mcp-catalog — Web client half.
 *
 * A read-only MCP catalog: sidebar entry → panel listing every MCP provider,
 * each expandable to its tools (name + purpose). A *bridge* provider (whose own
 * surface is a few meta tools) expands further into the real upstream servers and
 * their real tools.
 *
 * Data comes from the plugin's private Host RPC channel (`/dsh-mcp-catalog`), never
 * from the shared `/api`. Nothing in this panel writes.
 */
window.__ModuleLoader__.load({
	id: "dsh-mcp-catalog",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;

		/** Panel id; the sidebar entry and the `main` slot are addressed by it. */
		const PANEL_ID = "mcp-catalog";
		/** Private Host RPC channel (never the shared `/api`). */
		const CHANNEL = "/dsh-mcp-catalog";
		const NS = "dsh-mcp-catalog";
		const STYLE_ID = "dsh-mcp-catalog-style";

		const zh = {
			panel: "MCP",
			title: "MCP 目录",
			subtitle: (providers, tools) => `${providers} 个提供方 · ${tools} 个工具（只读）`,
			refresh: "刷新",
			refreshed: (time) => `更新于 ${time}`,
			searchPlaceholder: "搜索工具名或作用…",
			loading: "正在读取 MCP 目录…",
			failed: "读取失败",
			empty: "当前没有可用的 MCP 工具。",
			noMatch: "没有匹配的工具。",
			tools: (n) => `${n} 个工具`,
			bridge: "桥",
			bridgeHint: "该提供方本身只有元工具，可继续展开到真实上游",
			metaTools: "元工具（经此下钻）",
			upstreams: "真实上游服务",
			upstreamTools: (n) => `${n} 个工具`,
			loadingNested: "正在连接上游并枚举工具…",
			nestedFailed: "上游枚举失败",
			params: (n) => `参数 ${n}`,
			required: (n) => `必填 ${n}`,
			failedList: "部分上游连接失败",
		};

		const en = {
			panel: "MCP",
			title: "MCP catalog",
			subtitle: (providers, tools) => `${providers} providers · ${tools} tools (read-only)`,
			refresh: "Refresh",
			refreshed: (time) => `updated ${time}`,
			searchPlaceholder: "Search tool name or purpose…",
			loading: "Reading the MCP catalog…",
			failed: "Failed to read",
			empty: "No MCP tools are available.",
			noMatch: "No matching tools.",
			tools: (n) => `${n} tools`,
			bridge: "bridge",
			bridgeHint: "This provider exposes meta tools only; expand further for the real upstreams",
			metaTools: "Meta tools (the drill-down path)",
			upstreams: "Real upstream servers",
			upstreamTools: (n) => `${n} tools`,
			loadingNested: "Connecting upstreams and listing tools…",
			nestedFailed: "Upstream enumeration failed",
			params: (n) => `${n} params`,
			required: (n) => `${n} required`,
			failedList: "Some upstreams failed to connect",
		};

		const CSS = `
.dshmcp-root { display:flex; flex-direction:column; gap:12px; height:100%; min-height:0; padding:16px 20px 20px; box-sizing:border-box; color:var(--dsh-color-text, inherit); }
.dshmcp-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.dshmcp-title { margin:0; font-size:16px; font-weight:600; }
.dshmcp-sub { margin-top:2px; font-size:12px; color:var(--dsh-color-text-tertiary, #8a8f98); display:flex; gap:10px; align-items:center; }
.dshmcp-actions { display:flex; align-items:center; gap:8px; }
.dshmcp-btn { border:1px solid var(--dsh-color-border, rgba(127,127,127,.35)); background:transparent; color:inherit; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer; }
.dshmcp-btn:hover { border-color:var(--dsh-color-primary, #4b6bfb); }
.dshmcp-btn[disabled] { opacity:.5; cursor:default; }
.dshmcp-search { width:100%; box-sizing:border-box; padding:7px 10px; font-size:13px; border-radius:6px; border:1px solid var(--dsh-color-border, rgba(127,127,127,.35)); background:var(--dsh-color-bg, transparent); color:inherit; }
.dshmcp-search:focus { outline:none; border-color:var(--dsh-color-primary, #4b6bfb); }
.dshmcp-list { flex:1 1 auto; min-height:0; overflow:auto; border:1px solid var(--dsh-color-border, rgba(127,127,127,.25)); border-radius:8px; }
.dshmcp-provider + .dshmcp-provider { border-top:1px solid var(--dsh-color-border, rgba(127,127,127,.2)); }
.dshmcp-row { display:flex; align-items:center; gap:8px; width:100%; padding:9px 12px; background:transparent; border:0; color:inherit; font:inherit; text-align:left; cursor:pointer; }
.dshmcp-row:hover { background:color-mix(in srgb, currentColor 6%, transparent); }
.dshmcp-chev { flex:0 0 auto; width:12px; height:12px; transition:transform .12s ease; color:var(--dsh-color-text-tertiary, #8a8f98); }
.dshmcp-chev.open { transform:rotate(90deg); }
.dshmcp-name { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:13px; }
.dshmcp-provid { font-weight:600; font-family:inherit; }
.dshmcp-spacer { flex:1 1 auto; }
.dshmcp-chip { flex:0 0 auto; font-size:11px; padding:1px 7px; border-radius:999px; border:1px solid var(--dsh-color-border, rgba(127,127,127,.35)); color:var(--dsh-color-text-tertiary, #8a8f98); }
.dshmcp-chip.bridge { border-color:var(--dsh-color-primary, #4b6bfb); color:var(--dsh-color-primary, #4b6bfb); }
.dshmcp-body { padding:2px 12px 12px 32px; }
.dshmcp-tool { display:flex; gap:10px; padding:6px 0; border-top:1px dashed var(--dsh-color-border, rgba(127,127,127,.2)); }
.dshmcp-tool:first-child { border-top:0; }
.dshmcp-tool-name { flex:0 0 250px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; word-break:break-all; }
.dshmcp-tool-desc { flex:1 1 auto; font-size:12px; line-height:1.5; color:var(--dsh-color-text-tertiary, #8a8f98); white-space:pre-wrap; }
.dshmcp-tool-meta { flex:0 0 auto; font-size:11px; color:var(--dsh-color-text-tertiary, #8a8f98); }
.dshmcp-sect { margin:10px 0 4px; font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--dsh-color-text-tertiary, #8a8f98); }
.dshmcp-sub-row { display:flex; align-items:center; gap:8px; width:100%; padding:6px 8px; background:transparent; border:0; color:inherit; font:inherit; text-align:left; cursor:pointer; border-radius:6px; }
.dshmcp-sub-row:hover { background:color-mix(in srgb, currentColor 6%, transparent); }
.dshmcp-note { font-size:12px; color:var(--dsh-color-text-tertiary, #8a8f98); padding:6px 0; }
.dshmcp-error { font-size:12px; color:var(--dsh-color-danger, #e5484d); white-space:pre-wrap; }
.dshmcp-empty { padding:24px; text-align:center; font-size:13px; color:var(--dsh-color-text-tertiary, #8a8f98); }
`;

		function ensureStyles() {
			if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
		}

		function Chevron({ open }) {
			return h(
				"svg",
				{ className: open ? "dshmcp-chev open" : "dshmcp-chev", viewBox: "0 0 12 12", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" },
				h("path", { d: "M4.5 2.5L8 6l-3.5 3.5" }),
			);
		}

		function McpIcon() {
			return h(
				"svg",
				{ width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" },
				h("path", { d: "M4 7h8M4 12h13M4 17h9" }),
				h("circle", { cx: 17.5, cy: 7, r: 2.2 }),
				h("circle", { cx: 20, cy: 17, r: 1.8 }),
			);
		}

		function ToolRow({ tool, t }) {
			const meta = [tool.parameterCount ? t("params")(tool.parameterCount) : "", tool.required ? t("required")(tool.required) : ""]
				.filter(Boolean)
				.join(" · ");
			return h(
				"div",
				{ className: "dshmcp-tool" },
				h("div", { className: "dshmcp-tool-name" }, tool.name),
				h("div", { className: "dshmcp-tool-desc" }, tool.description || "—"),
				meta ? h("div", { className: "dshmcp-tool-meta" }, meta) : null,
			);
		}

		/** One expandable upstream server inside a bridge provider. */
		function UpstreamRow({ upstream, open, onToggle, t }) {
			return h(
				"div",
				null,
				h(
					"button",
					{ type: "button", className: "dshmcp-sub-row", onClick: onToggle, "aria-expanded": open ? "true" : "false" },
					h(Chevron, { open }),
					h("span", { className: "dshmcp-name" }, upstream.server),
					h("span", { className: "dshmcp-spacer" }),
					h("span", { className: "dshmcp-chip" }, t("upstreamTools")(upstream.toolCount)),
				),
				open
					? h(
							"div",
							{ className: "dshmcp-body" },
							upstream.tools.length
								? upstream.tools.map((tool) => h(ToolRow, { key: tool.name, tool, t }))
								: h("div", { className: "dshmcp-note" }, "—"),
						)
					: null,
			);
		}

		/** One provider row: meta tools, plus nested upstreams when it is the bridge. */
		function ProviderRow({ provider, isBridge, open, onToggle, query, nested, nestedState, expandUpstreams, toggleUpstream, t }) {
			const matches = query
				? provider.tools.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(query))
				: provider.tools;
			const upstreams = nested?.upstreams ?? [];
			const filteredUpstreams = query
				? upstreams
						.map((upstream) => ({
							...upstream,
							tools: upstream.tools.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(query)),
						}))
						.filter((upstream) => upstream.tools.length > 0)
				: upstreams;
			const hidden = query && matches.length === 0 && filteredUpstreams.length === 0;
			if (hidden) return null;

			return h(
				"div",
				{ className: "dshmcp-provider" },
				h(
					"button",
					{ type: "button", className: "dshmcp-row", onClick: onToggle, "aria-expanded": open ? "true" : "false" },
					h(Chevron, { open }),
					h("span", { className: "dshmcp-provid" }, provider.server),
					h("span", { className: "dshmcp-spacer" }),
					isBridge ? h("span", { className: "dshmcp-chip bridge" }, t("bridge")) : null,
					h("span", { className: "dshmcp-chip" }, t("tools")(provider.tools.length)),
				),
				open
					? h(
							"div",
							{ className: "dshmcp-body" },
							isBridge && nestedState === "loading" ? h("div", { className: "dshmcp-note" }, t("loadingNested")) : null,
							isBridge && nestedState === "error" ? h("div", { className: "dshmcp-error" }, nested?.error || t("nestedFailed")) : null,
							isBridge && nested?.available === false ? h("div", { className: "dshmcp-note" }, nested.reason || "") : null,
							isBridge ? h("div", { className: "dshmcp-sect" }, t("metaTools")) : null,
							matches.length
								? matches.map((tool) => h(ToolRow, { key: tool.name, tool, t }))
								: h("div", { className: "dshmcp-note" }, query ? t("noMatch") : "—"),
							isBridge && nested?.available
								? h(
										"div",
										null,
										h("div", { className: "dshmcp-sect" }, t("upstreams")),
										filteredUpstreams.length
											? filteredUpstreams.map((upstream) =>
													h(UpstreamRow, {
														key: upstream.server,
														upstream,
														open: expandUpstreams.has(upstream.server),
														onToggle: () => toggleUpstream(upstream.server),
														t,
													}),
												)
											: h("div", { className: "dshmcp-note" }, query ? t("noMatch") : "—"),
										nested.failed?.length
											? h("div", { className: "dshmcp-error" }, `${t("failedList")}: ${nested.failed.map((f) => f.server).join(", ")}`)
											: null,
									)
								: null,
						)
					: null,
			);
		}

		/** The page itself. */
		function McpPanel(props) {
			const t = props.t;
			const rpc = props.rpc;
			const [state, setState] = React.useState({ loading: true, error: "", providers: [], nestedServer: "ding", at: 0, refreshedAt: "" });
			const [openProviders, setOpenProviders] = React.useState(() => new Set(["ding"]));
			const [openUpstreams, setOpenUpstreams] = React.useState(() => new Set());
			const [nested, setNested] = React.useState(null);
			const [nestedState, setNestedState] = React.useState("idle");
			const [query, setQuery] = React.useState("");

			const loadInventory = React.useCallback(async () => {
				setState((prev) => ({ ...prev, loading: true, error: "" }));
				try {
					const envelope = await rpc.call(CHANNEL, "inventory", {});
					if (!envelope || envelope.ok !== true) {
						setState((prev) => ({ ...prev, loading: false, error: envelope?.error?.message || t("failed") }));
						return;
					}
					const value = envelope.value ?? {};
					setState({
						loading: false,
						error: "",
						providers: Array.isArray(value.providers) ? value.providers : [],
						nestedServer: typeof value.nestedServer === "string" ? value.nestedServer : "ding",
						at: value.generatedAt ?? Date.now(),
						refreshedAt: new Date().toLocaleTimeString(),
					});
				} catch (cause) {
					setState((prev) => ({ ...prev, loading: false, error: cause instanceof Error ? cause.message : String(cause) }));
				}
			}, [rpc, t]);

			const loadNested = React.useCallback(
				async (refresh) => {
					setNestedState("loading");
					try {
						const envelope = await rpc.call(CHANNEL, "nested", refresh ? { refresh: true } : {});
						if (!envelope || envelope.ok !== true) {
							setNested({ error: envelope?.error?.message || t("nestedFailed") });
							setNestedState("error");
							return;
						}
						setNested(envelope.value ?? {});
						setNestedState("ready");
					} catch (cause) {
						setNested({ error: cause instanceof Error ? cause.message : String(cause) });
						setNestedState("error");
					}
				},
				[rpc, t],
			);

			React.useEffect(() => {
				void loadInventory();
			}, [loadInventory]);

			const nestedServer = state.nestedServer;
			React.useEffect(() => {
				if (!nestedServer) return;
				if (openProviders.has(nestedServer) && nestedState === "idle") void loadNested(false);
			}, [openProviders, nestedServer, nestedState, loadNested]);

			const toggleProvider = React.useCallback((name) => {
				setOpenProviders((prev) => {
					const next = new Set(prev);
					if (next.has(name)) next.delete(name);
					else next.add(name);
					return next;
				});
			}, []);

			const toggleUpstream = React.useCallback((name) => {
				setOpenUpstreams((prev) => {
					const next = new Set(prev);
					if (next.has(name)) next.delete(name);
					else next.add(name);
					return next;
				});
			}, []);

			const refresh = React.useCallback(() => {
				void loadInventory();
				void loadNested(true);
			}, [loadInventory, loadNested]);

			const normalizedQuery = query.trim().toLowerCase();
			const totalTools = state.providers.reduce((sum, provider) => sum + provider.tools.length, 0);

			return h(
				"div",
				{ className: "dshmcp-root" },
				h(
					"div",
					{ className: "dshmcp-head" },
					h(
						"div",
						null,
						h("h2", { className: "dshmcp-title" }, t("title")),
						h(
							"div",
							{ className: "dshmcp-sub" },
							t("subtitle")(state.providers.length, totalTools),
							state.refreshedAt ? h("span", null, t("refreshed")(state.refreshedAt)) : null,
						),
					),
					h(
						"div",
						{ className: "dshmcp-actions" },
						h("button", { type: "button", className: "dshmcp-btn", onClick: refresh, disabled: state.loading }, t("refresh")),
					),
				),
				h("input", {
					className: "dshmcp-search",
					type: "search",
					value: query,
					placeholder: t("searchPlaceholder"),
					onChange: (event) => setQuery(event.target.value),
				}),
				h(
					"div",
					{ className: "dshmcp-list" },
					state.loading
						? h("div", { className: "dshmcp-empty" }, t("loading"))
						: state.error
							? h("div", { className: "dshmcp-empty dshmcp-error" }, `${t("failed")}: ${state.error}`)
							: state.providers.length === 0
								? h("div", { className: "dshmcp-empty" }, t("empty"))
								: state.providers.map((provider) =>
										h(ProviderRow, {
											key: provider.server,
											provider,
											isBridge: provider.server === nestedServer,
											open: openProviders.has(provider.server) || (normalizedQuery !== "" && provider.server === nestedServer),
											onToggle: () => toggleProvider(provider.server),
											query: normalizedQuery,
											nested: provider.server === nestedServer ? nested : null,
											nestedState: provider.server === nestedServer ? nestedState : "idle",
											expandUpstreams: openUpstreams,
											toggleUpstream,
											t,
										}),
								),
				),
			);
		}

		const inject = ["slots", "locale", "connection"];

		function apply(ctx) {
			ensureStyles();
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-mcp-catalog: locale dictionaries");
			const t = ctx.locale.bind(NS);

			// Sidebar entry (root-scoped list slot).
			ctx.slots.inject("sidebar.panellist", () =>
				ctx.slots.register(
					{
						name: "sidebar.panellist",
						id: PANEL_ID,
						order: 25,
						label: () => t("panel"),
						locale: NS,
					},
					McpIcon,
				),
			);

			// The page itself: root-scoped `main` keyed slot, keyed by the same id.
			ctx.slots.inject("main", () =>
				ctx.slots.register(
					{
						name: "main",
						key: PANEL_ID,
						locale: NS,
						inject: () => ({ rpc: ctx.connection.rpc, t }),
					},
					(registered) => h(McpPanel, registered),
				),
			);
		}

		exports.name = "dsh-mcp-catalog";
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	},
});