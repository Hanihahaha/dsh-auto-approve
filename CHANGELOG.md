# Changelog / 变更记录

dsh-auto-approve 的版本变更与 DeepSeek Harness 适配记录。
Version history and DeepSeek Harness compatibility record for dsh-auto-approve.

| Plugin | DSH baseline     | cordis |
| ------ | ---------------- | ------ |
| 0.3.0  | `0.1.7-alpha.2`  | 4.0.4  |
| 0.2.0  | `0.1.5-rc.1`     | 4.0.2  |
| 0.1.1  | `0.1.5-rc.1`     | 4.0.2  |
| 0.1.0  | `0.1.0-rc.6`     | 4.0.1  |

[中文](#中文) · [English](#english)

---

## 中文

### 0.3.0 — 适配 `@deepseek-ai/dsh` 0.1.7-alpha.2（cordis 4.0.4）

基准：`@deepseek-ai/dsh` **0.1.7-alpha.2**，cordis **4.0.4**（上一版按 `0.1.5-rc.1` / cordis `4.0.2` 编写）。

本轮修掉两个让**会话头部「审批」按钮完全失效**的问题。审批拦截本体（`auto-approve` 预设档位 + `/auto-approve` 命令）在 0.1.7 上本来就正常，未改。

1. **私有 RPC 通道从来没挂上（功能性缺陷，非 0.1.7 引入）。** 0.2.0 用 `ctx.connection.rpc.handle("/dsh-auto-approve", …)` 挂通道。`HostConnectionService` 的 `rpc` getter 读 `this.ctx`，而 cordis 会把服务 getter 里的上下文读取**绕回服务自己的 fiber**，于是 `rpc.handle` 内部的 `owner.webServer.register(...)` 在任何插件上下文里都解析不到 `webServer`：在 0.1.7-alpha.2 + cordis 4.0.4 上实测抛 `cannot get property "webServer" without inject`（本次通过在 `apply()` 里插桩捕获）。路由探测同样印证：`POST /dsh-auto-approve/status` 落到 frontend-static 兜底返回 405（与随机路径一致），而 `POST /api/...` 正常 200。因此按钮每次都走命令回退 —— 正是 0.2.0 想消除的那条会话记录回归。
   现改为 `ctx.connection.fetch.register({ path: "/api/dsh-auto-approve", methods: ["POST"], requestBody: "buffered", fetch })`：Fetch 路由只写服务自己的路由表，没有 `webServer` 依赖；`/api` 前缀路由会先做 Host/Origin 信任栅栏与浏览器会话校验再分发（未认证实测 401）。同时 `ctx.inject` 从 `["connection", "webServer"]` 收敛为 `["connection"]`。同仓的 `dsh-skill-mcp-manager` 在 0.2.0 就记录过同一个坑并改用了同样的方案，官方同类实现见 `@deepseek-ai/dsh-client-ui-deliverables` 的 `/api/present.open`。
2. **`ctx.sessions.list` 不再是「列表 + 当前选中」（0.1.7 破坏性变更）。** `SessionListState` 现在只有 `{ ids, byId, phase, projectionsBySession }`，`current` 字段被删除（"view selection remains outside the Controller"）。命令回退路径原先读 `getSnapshot().current`，在 0.1.7 上恒为 `undefined`，于是每次回退都答 `no active session`，按钮读数与切换全部失败。
   现改为在 `state.phase === "ready"` 闸门后读 `Object.values(state.byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)` —— 与官方 `ui-layout`、`ui-cordis`、`ui-workspace`（×4）、`ui-session`、`ui-agent-preset`、`settings-general` 共 8 处客户端代码同一读法。
3. **公开 API 更名。** `RPC_CHANNEL` → `FETCH_PATH`（`"/api/dsh-auto-approve"`），`rpcHandler` → `handleEndpoint`，新增 `serveRequest(request)`（校验方法 405 / JSON 体 400，返回 `{ ok, value }` / `{ ok, error }` 封套，`cache-control: no-store`）。客户端侧 `createModeApi` 的入参从 `{ rpc, runCommand }` 改为 `{ call, runCommand }`，并新增 `callRoute`、`currentSessionOf` 两个导出。
4. **peerDependencies** 更新为 `^0.1.7-alpha.2`，cordis `~4.0.4`。旧区间 `^0.1.5-rc.1` 按 semver 预发布规则**根本不匹配** `0.1.7-alpha.2`（comparator 元组为 0.1.5）。
5. **测试。** `test/host-rpc-smoke.mjs` 更名为 `test/host-route-smoke.mjs`，断言路由路径满足 `/api/<segment>` 形状、注册形状（`POST` / `buffered` / `fetch`）、实跑请求封套（200 / 405 / 400），并在代码碰到 `connection.rpc` 时直接失败。`client-smoke.mjs` 换成 `fetch` shim，新增「0.1.7 会话目录形状下能取到在台会话」「`phase` 未 ready 时不误报」「端点级失败不触发回退」三条断言。

核对后确认**未变化、因此本插件不改**：`approval/request` waterfall 形状与 `ApprovalOutcome` 词表（`allowed-once` 仍是唯一授权）；cordis `ctx.on(..., { prepend: true })`；`ctx.permissionPresets.current(session)` 的 Session 入参，以及「仍匹配的上次选择优先」规则（这正是 `auto-approve` 与 `workspace-write` 共享 knob 组合却仍能被识别的原因）；`ctx.commands.register` 的 `CommandDefinition`（含 `recordInput` / `input.hint`）与 `CommandInvocation.rawInput`；客户端 `ctx.slots.inject/register`（`conversation.session.header.actions`、`conversation.chat.commandview`）；`data-chat-flow-kind` 属性与 `displayPresetName` 的 kebab→Title Case 渲染；`ctx.remote.commands.execute(agentId, line, submittedAttachments)` 签名。

实盘核对：`POST /api/permissionPresets/catalog` 在 0.1.7-alpha.2 上返回 4 个档位（含 `auto-approve` 及其 `description`），`defaultPreset` 为 `workspace-write` —— 即 `cordis.patch.yml` 的 preset 表覆盖层在 0.1.7 下依然有效。

### 0.2.0 — 适配 `@deepseek-ai/dsh` 0.1.5-rc.1（cordis 4.0.2）

1. 头部按钮不再把命令记录写进会话：原先读写都走 `remote.commands.execute`，每次调用都会追加 `command/run` + `command/done`，聊天区渲染成一条永久的 `auto-approve · {"mode":…}` 行，而按钮每次挂载都要读一次 —— 每打开一个会话就多一条。现改用插件私有通道（本版用 `connection.rpc.handle`，见 0.3.0 第 1 条为何不可行）提供 `status` / `set`，完全不产生会话事件。
2. 抽出 `parseMode`，命令与浏览器侧共用同一写入路径；`/auto-approve` 设 `recordInput: false`（结算文本已含模式）。
3. 客户端新增 `conversation.chat.commandview` 的 `auto-approve` key 隐藏标记 + 一条 `:has()` 规则，把旧会话里已记录的命令行从聊天区隐去。
4. `package.json` 增加 peer `@deepseek-ai/dsh-client-connection` 并列入 `dsh.client.inject`；新增两个 Node 冒烟测试。

### 0.1.1 — 适配 `@deepseek-ai/dsh` 0.1.5-rc.1（cordis 4.0.2）

1. `permission.current(req.agent.session.events)` → `permission.current(req.agent.session)`：`Session` 已无 `events`，旧写法抛错并被 `try/catch` 吞掉，「自动审批」档位静默失效。
2. `approval/request` 监听器改为 `{ prepend: true }`，抢占 Web 审批面板的转发答案器。
3. `/auto-approve` 改用 `ctx.inject(["commands"], …)` 注册，避免与命令服务启动竞态。
4. `remote.commands.execute(sessionId, line, [])` 补齐必填的附件数组参数；命令通道失败时打印 `console.error`，不再静默吞掉。
5. peer 区间与 `dsh.client.inject` 更新到当时存在的包；preset 补 `description`。

### 0.1.0 — 初版

面向 `@deepseek-ai/dsh` **0.1.0-rc.6**（cordis **4.0.1**）：`auto-approve` 权限档位、`/auto-approve` 命令、以及拦截 `approval/request` 的自动批准。

---

## English

### 0.3.0 — `@deepseek-ai/dsh` 0.1.7-alpha.2 (cordis 4.0.4)

Baseline: `@deepseek-ai/dsh` **0.1.7-alpha.2**, cordis **4.0.4** (the previous revision targeted `0.1.5-rc.1` / cordis `4.0.2`).

This revision fixes two defects that made the **session-header "approve" control completely dead**. The approval interception itself (the `auto-approve` preset plus the `/auto-approve` command) already worked on 0.1.7 and is unchanged.

1. **The private RPC channel never mounted (a functional defect, not a 0.1.7 regression).** 0.2.0 mounted it with `ctx.connection.rpc.handle("/dsh-auto-approve", …)`. `HostConnectionService`'s `rpc` getter reads `this.ctx`, and cordis routes a service getter's context reads back through the **service's own** fiber, so the channel's internal `owner.webServer.register(...)` cannot resolve `webServer` from any plugin context: measured on 0.1.7-alpha.2 + cordis 4.0.4 it throws `cannot get property "webServer" without inject` (captured here by instrumenting `apply()`). Route probing agrees — `POST /dsh-auto-approve/status` fell through to the frontend-static fallback as a 405 (identical to a random path) while `POST /api/...` answered 200. The toggle therefore always took the command fallback, which is exactly the session-row regression 0.2.0 set out to remove.
   It now registers `ctx.connection.fetch.register({ path: "/api/dsh-auto-approve", methods: ["POST"], requestBody: "buffered", fetch })`: the Fetch-route registry writes only into the service's own table and has no `webServer` dependency, and the `/api` prefix route applies the Host/Origin trust fence plus the browser-session check before dispatch (401 verified unauthenticated). `ctx.inject` narrowed from `["connection", "webServer"]` to `["connection"]`. The sibling `dsh-skill-mcp-manager` recorded the same trap and adopted the same fix in its own 0.2.0; the first-party equivalent is `@deepseek-ai/dsh-client-ui-deliverables`' `/api/present.open`.
2. **`ctx.sessions.list` is no longer "catalog plus current selection" (a 0.1.7 breaking change).** `SessionListState` is now `{ ids, byId, phase, projectionsBySession }` and the `current` field is gone ("view selection remains outside the Controller"). The command fallback read `getSnapshot().current`, which is always `undefined` on 0.1.7, so every fallback answered `no active session` and the control could neither read nor write the mode.
   It now reads `Object.values(state.byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)` behind a `state.phase === "ready"` gate — the same idiom used by eight shipped client sites (`ui-layout`, `ui-cordis`, `ui-workspace` ×4, `ui-session`, `ui-agent-preset`, `settings-general`).
3. **Public API renamed.** `RPC_CHANNEL` → `FETCH_PATH` (`"/api/dsh-auto-approve"`), `rpcHandler` → `handleEndpoint`, plus a new `serveRequest(request)` that gates the method (405) and the JSON body (400) and answers with the `{ ok, value }` / `{ ok, error }` envelope and `cache-control: no-store`. Client-side, `createModeApi` takes `{ call, runCommand }` instead of `{ rpc, runCommand }`, and `callRoute` / `currentSessionOf` are new exports.
4. **peerDependencies** moved to `^0.1.7-alpha.2` with cordis `~4.0.4`. The old `^0.1.5-rc.1` range does not even match `0.1.7-alpha.2` under semver prerelease rules (its comparator tuple is 0.1.5).
5. **Tests.** `test/host-rpc-smoke.mjs` is renamed to `test/host-route-smoke.mjs` and now asserts the `/api/<segment>` route shape, the registration shape (`POST` / `buffered` / `fetch`), exercises the real request envelope (200 / 405 / 400), and fails loudly if the code reaches for `connection.rpc`. `client-smoke.mjs` switched to a `fetch` shim and gained assertions for "resolves the on-stage session from the 0.1.7 catalog shape", "a catalog that is not `ready` reports no session", and "an endpoint-level failure never triggers the fallback".

Audited and left unchanged: the `approval/request` waterfall shape and `ApprovalOutcome` vocabulary (`allowed-once` is still the only grant); cordis `ctx.on(..., { prepend: true })`; `ctx.permissionPresets.current(session)`'s Session argument and its "still-matching last selection wins" rule (which is what lets `auto-approve` share `workspace-write`'s knob bundle and still be identified); `ctx.commands.register`'s `CommandDefinition` (including `recordInput` / `input.hint`) and `CommandInvocation.rawInput`; client-side `ctx.slots.inject/register` (`conversation.session.header.actions`, `conversation.chat.commandview`); the `data-chat-flow-kind` attribute and `displayPresetName`'s kebab→Title-Case rendering; and the `ctx.remote.commands.execute(agentId, line, submittedAttachments)` signature.

Verified live: `POST /api/permissionPresets/catalog` on 0.1.7-alpha.2 returns four presets (including `auto-approve` with its `description`) and `defaultPreset: "workspace-write"` — so `cordis.patch.yml`'s preset-table override still applies on 0.1.7.

### 0.2.0 — `@deepseek-ai/dsh` 0.1.5-rc.1 (cordis 4.0.2)

1. The header control stopped writing command records into the session: it used `remote.commands.execute` for both reads and writes, and every call appended a `command/run` + `command/done` pair that the chat rendered as a permanent `auto-approve · {"mode":…}` row, while the control reads the mode on every mount — one row per opened session. It moved to a private plugin route (`connection.rpc.handle` in that revision; see 0.3.0 item 1 for why that could not work) serving `status` / `set` and producing no session events at all.
2. Extracted `parseMode` so the command and the browser wire share one write path; `/auto-approve` set `recordInput: false` (the settlement text already names the mode).
3. The client half added the `auto-approve` key of `conversation.chat.commandview` rendering a hidden marker plus one `:has()` rule, removing already-recorded command rows from the chat.
4. `package.json` gained the `@deepseek-ai/dsh-client-connection` peer and listed it in `dsh.client.inject`; two Node smoke suites were added.

### 0.1.1 — `@deepseek-ai/dsh` 0.1.5-rc.1 (cordis 4.0.2)

1. `permission.current(req.agent.session.events)` → `permission.current(req.agent.session)`: the `Session` no longer exposed `events`, so the old call threw inside its own guard and the Auto approve preset silently did nothing.
2. The `approval/request` listener moved to `{ prepend: true }` to claim requests ahead of the Web approval panel's forwarded answerer.
3. `/auto-approve` registers through `ctx.inject(["commands"], …)` instead of racing the command registry at apply time.
4. `remote.commands.execute(sessionId, line, [])` supplies the required attachment array, and a failed command channel now logs `console.error` instead of swallowing the failure.
5. Peer ranges and `dsh.client.inject` moved to packages that exist; the preset gained a `description`.

### 0.1.0 — initial release

Targeted `@deepseek-ai/dsh` **0.1.0-rc.6** (cordis **4.0.1**): the `auto-approve` permission preset, the `/auto-approve` command, and `approval/request` interception.
