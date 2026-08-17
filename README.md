# dsh-auto-approve

[中文](README.zh.md)

A DeepSeek Harness plugin that adds an auto-approve permission mode and can automatically grant sandbox or all approval requests.

## Features

- Adds an **Auto approve** permission preset that preserves the `workspace-write` boundary.
- Provides `/auto-approve all|sandbox|off|status`.
- Adds a session-header control that cycles between off, sandbox-only, and all approvals.
- Intercepts the `approval/request` waterfall and returns `allowed-once` for the selected mode.

## Install

```powershell
# Install from the repository root.
dsh plugin --profile web add ".\packages\dsh-auto-approve"

# Or, after publishing
dsh plugin --profile web add dsh-auto-approve
```

Restart `dsh web` after installation. The permission selector then exposes the Auto approve preset and the command and header control become available.

## How It Works

| Layer | Behavior |
|---|---|
| Permission preset | Extends `@deepseek-ai/dsh-permission-presets` with `auto-approve` using `workspace-write` plus `ask`. |
| Approval handling | Intercepts `approval/request`; the preset grants all requests, while the manual mode grants sandbox-only, all, or none. |

DSH has `ask` and `never` policies but no native auto-approve policy. This plugin implements auto-approval by short-circuiting the waterfall. `never` means reject, not auto-approve.

## Security

- `all` grants every approval request and is only suitable for trusted tasks.
- Manual mode is process-local and returns to the default `sandbox` mode after restart.
- The Auto approve preset remains constrained to `workspace-write`; requests outside the workspace still use escalation, although this plugin grants the resulting approval.
