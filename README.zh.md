# dsh-auto-approve

[English](README.md)

DeepSeek Harness 的**自动审批模式**插件：自动批准审批请求，不再弹窗，并在权限选择器中增加「自动审批」档位（类似 Codex 的 auto-approve / 帮我批准模式）。

## 功能

- **权限选择器新档位「自动审批」**：选择后所有审批请求自动通过（工作区沙箱边界保留，`workspace-write`）。
- **手动模式开关**：`/auto-approve all|sandbox|off|status`
  - `sandbox`（默认）：仅自动批准沙箱权限升级请求
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
| 权限档位 | 本包 patch 层覆盖 `permission` 插件行（`@deepseek-ai/dsh-permission-presets`）的 preset 表，新增 `auto-approve` 条目（`sandbox: workspace-write` + `approval: ask`） |
| 自动批准 | 插件监听 `approval/request` waterfall；档位为 `auto-approve` 时全部自动批准，否则按手动模式（sandbox/all/off）处理 |

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
