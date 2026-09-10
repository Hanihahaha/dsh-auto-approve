# dsh-auto-approve

[中文](README.zh.md)

A DeepSeek Harness plugin that adds an auto-approve permission mode and can automatically grant requests matching its sandbox-reason heuristic or all approval requests.

> **Compatibility:** verified against `@deepseek-ai/dsh` **0.1.5-rc.1** (cordis 4.0.2). See "Version adaptation" below.

## Features

- Adds an **Auto approve** permission preset that preserves the `workspace-write` boundary.
- Provides `/auto-approve all|sandbox|off|status`.
- Adds a session-header control that cycles between off, sandbox-matched, and all approvals.
- Intercepts the `approval/request` waterfall and returns `allowed-once` for the selected mode.

## Install

```powershell
# Install from the repository root.
dsh plugin --profile web add ".\dsh-auto-approve"

# Or, after publishing
dsh plugin --profile web add dsh-auto-approve
```

Restart `dsh web` after installation. The permission selector then exposes the Auto approve preset and the command and header control become available.

## How It Works

| Layer | Behavior |
|---|---|
| Permission preset | Extends `@deepseek-ai/dsh-permission-presets` with `auto-approve` using `workspace-write` plus `ask`. |
| Approval handling | Intercepts `approval/request`; the preset grants all requests, while manual `sandbox` mode grants requests whose reason text contains `sandbox`, `all` grants every request, and `off` grants none. |

Implementation notes (current host APIs):

- The preset probe calls `ctx.permissionPresets.current(agent.session)` — the service takes the **Session** itself (it folds the `permissions` session projection), not `session.events`;
- The listener registers with `{ prepend: true }`. In the Web profile `@deepseek-ai/dsh-api-remotes` forwards `approval/request` to the browser approval panel and awaits the human, and a cordis waterfall stops at the first listener that does not call `next()` — so the claim must not depend on plugin load order;
- `/auto-approve` registers through `ctx.inject(["commands"], …)` instead of racing the command registry at apply time;
- The client toggle uses the standard wire contract `ctx.remote.commands.execute(agentId, line, [])` (three business arguments — an untagged client context does not get its agent id projected away).

DSH has `ask` and `never` policies but no native auto-approve policy. This plugin implements auto-approval by short-circuiting the waterfall. `never` means reject, not auto-approve.

## Security

- `all` grants every approval request and is only suitable for trusted tasks.
- Manual mode is process-local and returns to the default `sandbox` mode after restart.
- The Auto approve preset remains constrained to `workspace-write`; requests outside the workspace still use escalation, although this plugin grants the resulting approval.

## Version adaptation (0.1.1, for dsh 0.1.5-rc.1)

| Location | Before (0.1.0) | Now (0.1.1) |
|---|---|---|
| `lib/index.js` | `permission.current(req.agent.session.events)` | `permission.current(req.agent.session)` — the current `Session` no longer exposes `events`, so the old call threw inside its own guard and the Auto approve preset silently did nothing |
| `lib/index.js` | `ctx.on("approval/request", handler)` | `ctx.on("approval/request", handler, { prepend: true })` |
| `lib/index.js` | `ctx.get("commands")` + `ctx.effect(...)` | `ctx.inject(["commands"], (commandCtx) => …)` |
| `lib/client.js` | `remote.commands.execute(sessionId, line)` | `remote.commands.execute(sessionId, line, [])`, plus `console.error` on a failed command channel instead of a silent no-op |
| `package.json` | peers `^0.1.0-rc.6`; `dsh.client.inject` named the removed `dsh-client-runtime` | peers `^0.1.5-rc.1` (cordis `^4.0.2`); `dsh.client.inject` names the four packages that exist today |
| `cordis.patch.yml` | `auto-approve` had no copy | added a `description` so `/permission` can tell it apart from `workspace-write` (no `name`: a missing label is title-cased from the kebab key into `Auto Approve`) |
