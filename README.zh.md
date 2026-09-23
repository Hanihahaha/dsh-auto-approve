# dsh-auto-approve

[English](README.md)

DeepSeek Harness 的**自动审批模式**插件：自动批准审批请求，不再弹窗，并在权限选择器中增加「自动审批」档位（类似 Codex 的 auto-approve / 帮我批准模式）。

> **兼容版本**：已按 `@deepseek-ai/dsh` **0.1.7-alpha.2**（cordis 4.0.4）核对并修正；逐版本适配记录见 [CHANGELOG.md](CHANGELOG.md)。

## 功能

- **权限选择器新档位「自动审批」**：选择后所有审批请求自动通过（工作区沙箱边界保留，`workspace-write`）。
- **手动模式开关**：`/auto-approve all|sandbox|off|status`
  - `sandbox`（默认）：自动批准审批原因文本中包含 `sandbox` 的请求（当前为文本启发式判断）
  - `all`：自动批准所有审批请求
  - `off`：关闭，恢复原生手动审批
- **会话头部按钮**：标题栏右侧出现 `审批:沙箱` 按钮，点击循环切换 `关 → 沙箱 → 全部`。按钮走插件自己的受认证 Fetch 路由与 Host 通信，**不会**在会话里留下任何记录。
- **隐藏历史记录行**：聊天区里 `/auto-approve` 命令行的渲染被替换为「不显示」，因此旧版本已经写进会话日志的那些行也不再出现。
- 插件拦截 `approval/request` waterfall 并返回 `allowed-once`，完全跳过用户审批弹窗。

## 安装（每个部署执行一次）

在 harness 所在机器上，用任意 profile（如 `web`）安装本包：

```powershell
# 从仓库根目录通过本地路径安装
dsh plugin --profile web add ".\dsh-auto-approve"

# 或发布到 npm 后按包名安装
dsh plugin --profile web add dsh-auto-approve
```

重启 harness（`dsh web`）后生效：

1. 权限选择器（输入框下方）多出 **自动审批** 档位；
2. 插件自动运行，`/auto-approve status` 可查看状态；
3. 会话头部出现「审批」切换按钮。

> 升级本插件后需要**重启 `dsh web` 进程**：`@deepseek-ai/dsh-client-modules` 在启动时对每个插件的浏览器 bundle 做快照，profile 的热重载只监听 patch 文件、不监听插件代码，因此客户端与 Host 两个半边都是重启后一起生效。

## 工作原理

| 层 | 机制 |
| --- | --- |
| 权限档位 | 本包 patch 层覆盖 `permission` 插件行（`@deepseek-ai/dsh-permission-presets`）的 preset 表，新增 `auto-approve` 条目（`sandbox: workspace-write` + `approval: ask`，另带一条中文说明） |
| 自动批准 | 插件监听 `approval/request` waterfall 并返回 `allowed-once`；档位为 `auto-approve` 时全部自动批准，否则按手动模式（sandbox/all/off）处理 |
| 头部按钮 | 用同源 `fetch` 往本插件私有受认证路由 `/api/dsh-auto-approve` POST `{ endpoint, payload }`（`status` / `set`）。不产生会话事件，因此不产生会话记录 |
| 命令行渲染 | 在 keyed 槽位 `conversation.chat.commandview` 里用「隐藏标记」替换 `auto-approve` 的渲染器，并用一条作用域受限的 `:has()` 规则隐藏外层 Chat flow item |

实现要点（与当前 DSH API 对齐）：

- 档位读取用 `ctx.permissionPresets.current(agent.session)` —— 该服务要的是 **Session 对象**（它折叠 `permissions` session projection），不是 `session.events`；
- 监听器以 `{ prepend: true }` 注册。Web profile 里 `@deepseek-ai/dsh-api-remotes` 会把 `approval/request` 转发给浏览器审批面板并等待人工点击，而 waterfall 是「第一个不调用 `next()` 的监听器胜出」，因此必须抢占在它之前，不能依赖插件加载顺序；
- `/auto-approve` 命令通过 `ctx.inject(["commands"], …)` 注册，避免与命令服务启动竞态；
- 头部按钮**不使用**该命令：每次 `commands.execute` 都会往会话日志追加 `command/run` + `command/done`，聊天区会把它渲染成一条永久的 `auto-approve · {"mode":…}` 记录，而按钮每次挂载都要读一次模式 —— 于是以前每打开一个会话就多出一条。现在 Host 半边用 `ctx.connection.fetch.register({ path: "/api/dsh-auto-approve", methods: ["POST"], requestBody: "buffered", fetch })` 注册一条精确 Fetch 路由，客户端往它 POST `{ endpoint, payload }`；路由与会话无关，所以不写任何日志。Connection 的 `/api` 前缀路由会先做 Host/Origin 信任栅栏与浏览器会话校验再分发，因此这条路由只会在已认证的 operator 请求下执行。若 Host 半边早于该路由（或该 profile 里路由注册没跑起来），请求会拿到 HTTP 状态码，按钮本次页面加载退回命令通道并在控制台 `console.warn` 一次，而不是变成一个点不动的按钮。
- 之所以用 Fetch 路由而不是 Connection RPC 通道：`ctx.connection.rpc.handle` **根本挂不上通道**。`HostConnectionService` 的 `rpc` getter 读 `this.ctx`，而 cordis 会把服务 getter 里的上下文读取绕回服务自己的 fiber，于是通道内部的 `owner.webServer.register(...)` 在任何插件上下文里都解析不到 `webServer`（0.1.7-alpha.2 + cordis 4.0.4 实测报 `cannot get property "webServer" without inject`）。Fetch 路由只写服务自己的路由表，没有这一依赖；官方同类实现见 `@deepseek-ai/dsh-client-ui-deliverables` 的 `/api/present.open`。
- 按钮的路由与会话无关（模式是进程内状态），但旧的命令回退路径需要会话，而 0.1.7 删掉了它用的字段。`SessionListState` 现在只有 `{ ids, byId, phase, projectionsBySession }`（"view selection remains outside the Controller"），因此改为在 `state.phase === "ready"` 闸门后读 `Object.values(state.byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)` —— 与官方 `ui-layout`、`ui-cordis`、`ui-workspace`、`ui-session`、`ui-agent-preset`、`settings-general` 六处客户端代码同一读法。
- 旧会话里已经写入的 `auto-approve` 命令行属于会话历史，插件不该改写它；但「是否显示」是渲染层的选择。`conversation.chat.commandview` 是按命令名 keyed 的槽位，其契约明确写着「复用同一个 key 会替换该命令的渲染器」，因此客户端半边用隐藏标记注册 `auto-approve` 这个 key，并附带一条样式规则 `[data-chat-flow-kind="command"]:has(.dsh-auto-approve-suppressed){display:none}`：隐藏的是 Chat 的 flow item（条目间距就在它身上，只藏行内容会留下等量空白），而不是只藏行包装。`data-chat-flow-kind` 与 `:has()` 都是外壳内部约定，一旦缺失规则自动失效、这些行重新出现，不会影响其他界面。副作用：自己手打的 `/auto-approve` 在聊天区同样不显示，状态以头部按钮为准。

> 说明：DSH 原生审批策略只有 `ask`/`never`（无 `auto`），因此"自动批准"由本插件在 waterfall 层短路实现。`never` 是"拒绝"而非"自动批准"。

## 安全提示

- `all` 模式会放行一切审批（包括非沙箱类），仅在可信任务中使用；
- 模式状态为进程内内存：重启 harness 后回到默认 `sandbox`；
- 「自动审批」档位保留 `workspace-write` 沙箱边界（工作区外写入仍需升级，但升级会被自动批准）——比 `danger-full-access` 更克制。

## 开发

```powershell
# 结构
#   package.json        npm 包 + dsh bundle 声明
#   cordis.patch.yml    bundle patch：插入插件行 + 扩展权限预设表
#   lib/index.js        Host 插件（ESM，export { apply, name }）
#   lib/client.js       Client bundle（手写 lazy-CJS）
#   test/               Node 冒烟测试（无需 harness 进程）
```

```powershell
# Host：路由路径与注册形状、请求封套、waterfall 抢占、命令切换
node test/host-route-smoke.mjs

# Client：无日志路由路径、旧 Host 回退、slot 注册
node test/client-smoke.mjs
```
