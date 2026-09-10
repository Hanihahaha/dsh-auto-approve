# dsh-auto-approve

[English](README.md)

DeepSeek Harness 的**自动审批模式**插件：自动批准审批请求，不再弹窗，并在权限选择器中增加「自动审批」档位（类似 Codex 的 auto-approve / 帮我批准模式）。

> **兼容版本**：已按 `@deepseek-ai/dsh` **0.1.5-rc.1**（cordis 4.0.2）核对并修正，改动见文末「版本适配记录」。

## 功能

- **权限选择器新档位「自动审批」**：选择后所有审批请求自动通过（工作区沙箱边界保留，`workspace-write`）。
- **手动模式开关**：`/auto-approve all|sandbox|off|status`
  - `sandbox`（默认）：自动批准审批原因文本中包含 `sandbox` 的请求（当前为文本启发式判断）
  - `all`：自动批准所有审批请求
  - `off`：关闭，恢复原生手动审批
- **会话头部按钮**：标题栏右侧出现 `审批:沙箱` 按钮，点击循环切换 `关 → 沙箱 → 全部`。
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

## 工作原理

| 层 | 机制 |
| --- | --- |
| 权限档位 | 本包 patch 层覆盖 `permission` 插件行（`@deepseek-ai/dsh-permission-presets`）的 preset 表，新增 `auto-approve` 条目（`sandbox: workspace-write` + `approval: ask`，另带一条中文说明） |
| 自动批准 | 插件监听 `approval/request` waterfall 并返回 `allowed-once`；档位为 `auto-approve` 时全部自动批准，否则按手动模式（sandbox/all/off）处理 |

实现要点（与当前 DSH API 对齐）：

- 档位读取用 `ctx.permissionPresets.current(agent.session)` —— 该服务要的是 **Session 对象**（它折叠 `permissions` session projection），不是 `session.events`；
- 监听器以 `{ prepend: true }` 注册。Web profile 里 `@deepseek-ai/dsh-api-remotes` 会把 `approval/request` 转发给浏览器审批面板并等待人工点击，而 waterfall 是「第一个不调用 `next()` 的监听器胜出」，因此必须抢占在它之前，不能依赖插件加载顺序；
- `/auto-approve` 命令通过 `ctx.inject(["commands"], …)` 注册，避免与命令服务启动竞态；
- 客户端按钮走标准 wire 契约 `ctx.remote.commands.execute(agentId, line, [])`（三个业务参数，未挂 agent scope 的客户端上下文不会自动省略 agentId）。

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
```

## 版本适配记录（0.1.1，针对 dsh 0.1.5-rc.1）

| 位置 | 旧写法（0.1.0） | 现写法（0.1.1） |
| --- | --- | --- |
| `lib/index.js` | `permission.current(req.agent.session.events)` | `permission.current(req.agent.session)` —— 当前 `Session` 已无 `events` 属性，旧写法会抛错并被 `try/catch` 吞掉，导致「自动审批」档位静默失效 |
| `lib/index.js` | `ctx.on("approval/request", handler)` | `ctx.on("approval/request", handler, { prepend: true })` |
| `lib/index.js` | `ctx.get("commands")` + `ctx.effect(...)` | `ctx.inject(["commands"], (commandCtx) => …)` |
| `lib/client.js` | `remote.commands.execute(sessionId, line)` | `remote.commands.execute(sessionId, line, [])`，并让命令通道失败时打印 `console.error` 而不是静默吞掉 |
| `package.json` | peer `^0.1.0-rc.6`、`dsh.client.inject` 含已移除的 `dsh-client-runtime` | peer `^0.1.5-rc.1`（cordis `^4.0.2`）、`dsh.client.inject` 改为当前存在的四个包 |
| `cordis.patch.yml` | `auto-approve` 无说明 | 补 `description`，便于在 `/permission` 菜单里与 `workspace-write` 区分（预设名缺省时前端会把 kebab 键渲染为 `Auto Approve`，因此不写 `name`） |
