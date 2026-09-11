# dsh-auto-approve

[中文](README.zh.md)

A DeepSeek Harness plugin that adds an auto-approve permission mode and can automatically grant requests matching its sandbox-reason heuristic or all approval requests.

> **Compatibility:** verified against `@deepseek-ai/dsh` **0.1.5-rc.1** (cordis 4.0.2). See "Version adaptation" below.

## Features

- Adds an **Auto approve** permission preset that preserves the `workspace-write` boundary.
- Provides `/auto-approve all|sandbox|off|status`.
- Adds a session-header control that cycles between off, sandbox-matched, and all approvals. The control talks to the host over the plugin's own Connection RPC channel, so it writes **no** conversation rows.
- Replaces the `/auto-approve` command row in the chat with nothing, so rows already recorded in older sessions stop showing up as well.
- Intercepts the `approval/request` waterfall and returns `allowed-once` for the selected mode.

## Install

```powershell
# Install from the repository root.
dsh plugin --profile web add ".\dsh-auto-approve"

# Or, after publishing
dsh plugin --profile web add dsh-auto-approve
```

Restart `dsh web` after installation. The permission selector then exposes the Auto approve preset, and the command and header control become available. An upgrade needs the same restart for both halves: `@deepseek-ai/dsh-client-modules` snapshots each plugin's browser bundle at boot, and the profile's live patch reload watches patch files rather than plugin code.

## How It Works

| Layer | Behavior |
|---|---|
| Permission preset | Extends `@deepseek-ai/dsh-permission-presets` with `auto-approve` using `workspace-write` plus `ask`. |
| Approval handling | Intercepts `approval/request`; the preset grants all requests, while manual `sandbox` mode grants requests whose reason text contains `sandbox`, `all` grants every request, and `off` grants none. |
| Header toggle | Calls the private Connection channel `/dsh-auto-approve` (`status` / `set`) through `ctx.connection.rpc.call`. No session events, no conversation rows. |
| Command row | Replaces the `auto-approve` renderer in the keyed `conversation.chat.commandview` slot with a hidden marker, and hides the enclosing Chat flow item with one scoped `:has()` rule. |

Implementation notes (current host APIs):

- The preset probe calls `ctx.permissionPresets.current(agent.session)` — the service takes the **Session** itself (it folds the `permissions` session projection), not `session.events`;
- The listener registers with `{ prepend: true }`. In the Web profile `@deepseek-ai/dsh-api-remotes` forwards `approval/request` to the browser approval panel and awaits the human, and a cordis waterfall stops at the first listener that does not call `next()` — so the claim must not depend on plugin load order;
- `/auto-approve` registers through `ctx.inject(["commands"], …)` instead of racing the command registry at apply time;
- The toggle does **not** use that command. Every `commands.execute` appends a `command/run` + `command/done` pair to the session log, which the chat renders as a permanent `auto-approve · {"mode":…}` row — and the toggle reads the mode on every mount, so the command path left one row per opened session. The host half mounts a private channel with `ctx.connection.rpc.handle("/dsh-auto-approve", …)` and the client half calls it with `ctx.connection.rpc.call(channel, endpoint, payload)`; a channel route is unrelated to any session, so nothing is logged. A host half that predates the channel — or any profile where the channel registration never ran — answers it with a transport failure, and the toggle then falls back to the slash command for that page load, printing one `console.warn`, instead of leaving a dead button.
- Rows already written to older sessions are session history, which the plugin must not rewrite — but showing them is a renderer choice. The `conversation.chat.commandview` slot is keyed by command name and its contract states that reusing a key *replaces* that command's renderer, so the client half registers the key `auto-approve` with a hidden marker and ships one stylesheet rule, `[data-chat-flow-kind="command"]:has(.dsh-auto-approve-suppressed){display:none}`. It hides the Chat flow item (the element that owns the inter-item gap, so no blank gap is left behind) rather than only the row wrapper. Both the flow-kind attribute and `:has()` are shell internals: if either disappears, the rule stops matching and the rows simply reappear — no other surface is affected. `/auto-approve` typed by hand is therefore invisible in the chat too; the header button is the visible state.

DSH has `ask` and `never` policies but no native auto-approve policy. This plugin implements auto-approval by short-circuiting the waterfall. `never` means reject, not auto-approve.

## Security

- `all` grants every approval request and is only suitable for trusted tasks.
- Manual mode is process-local and returns to the default `sandbox` mode after restart.
- The Auto approve preset remains constrained to `workspace-write`; requests outside the workspace still use escalation, although this plugin grants the resulting approval.

## Version adaptation (0.2.0, for dsh 0.1.5-rc.1)

| Location | Before (0.1.1) | Now (0.2.0) |
|---|---|---|
| `lib/index.js` | — | mounts `ctx.connection.rpc.handle("/dsh-auto-approve", …)` with `status` / `set`, so the header toggle no longer writes `command/run` + `command/done` (one `auto-approve` conversation row per session open) |
| `lib/index.js` | mode words applied inline in the command handler | one `parseMode` write path shared by the command and the channel |
| `lib/index.js` | `/auto-approve` recorded its input | `recordInput: false` — the settlement text already names the mode |
| `lib/client.js` | `remote.commands.execute(sessionId, line, [])` for reads and writes | `connection.rpc.call("/dsh-auto-approve", endpoint, payload)`, with the command path kept only as a fallback for a stale host half (warned once per page) |
| `lib/client.js` | every `/auto-approve` execution left a visible command row | the `auto-approve` key of `conversation.chat.commandview` renders a hidden marker, plus one `:has()` rule that hides the enclosing flow item — rows recorded by older versions disappear from the chat |
| `package.json` | peers without the Connection carrier | peer `@deepseek-ai/dsh-client-connection`; `dsh.client.inject` lists it |
| `test/` | none | `host-rpc-smoke.mjs` + `client-smoke.mjs` pin the log-free toggle, the row suppression, and the fallback |

## Version adaptation (0.1.1, for dsh 0.1.5-rc.1)

| Location | Before (0.1.0) | Now (0.1.1) |
|---|---|---|
| `lib/index.js` | `permission.current(req.agent.session.events)` | `permission.current(req.agent.session)` — the current `Session` no longer exposes `events`, so the old call threw inside its own guard and the Auto approve preset silently did nothing |
| `lib/index.js` | `ctx.on("approval/request", handler)` | `ctx.on("approval/request", handler, { prepend: true })` |
| `lib/index.js` | `ctx.get("commands")` + `ctx.effect(...)` | `ctx.inject(["commands"], (commandCtx) => …)` |
| `lib/client.js` | `remote.commands.execute(sessionId, line)` | `remote.commands.execute(sessionId, line, [])`, plus `console.error` on a failed command channel instead of a silent no-op |
| `package.json` | peers `^0.1.0-rc.6`; `dsh.client.inject` named the removed `dsh-client-runtime` | peers `^0.1.5-rc.1` (cordis `^4.0.2`); `dsh.client.inject` names the packages that exist today |
| `cordis.patch.yml` | `auto-approve` had no copy | added a `description` so `/permission` can tell it apart from `workspace-write` (no `name`: a missing label is title-cased from the kebab key into `Auto Approve`) |

## Tests

```powershell
# Host half: channel shape, endpoint results, waterfall claim, command switch.
node test/host-rpc-smoke.mjs

# Client half: the log-free channel path, the stale-host fallback, the slot.
node test/client-smoke.mjs
```
