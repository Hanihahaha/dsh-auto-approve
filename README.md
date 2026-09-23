# dsh-auto-approve

[中文](README.zh.md)

A DeepSeek Harness plugin that adds an auto-approve permission mode and can automatically grant requests matching its sandbox-reason heuristic or all approval requests.

> **Compatibility:** verified against `@deepseek-ai/dsh` **0.1.7-alpha.2** (cordis 4.0.4). Per-version adaptation records live in [CHANGELOG.md](CHANGELOG.md).

## Features

- Adds an **Auto approve** permission preset that preserves the `workspace-write` boundary.
- Provides `/auto-approve all|sandbox|off|status`.
- Adds a session-header control that cycles between off, sandbox-matched, and all approvals. The control talks to the host over the plugin's own authenticated Fetch route, so it writes **no** conversation rows.
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
| Header toggle | Posts `{ endpoint, payload }` to the plugin's own authenticated Fetch route `/api/dsh-auto-approve` (`status` / `set`) with a plain same-origin `fetch`. No session events, no conversation rows. |
| Command row | Replaces the `auto-approve` renderer in the keyed `conversation.chat.commandview` slot with a hidden marker, and hides the enclosing Chat flow item with one scoped `:has()` rule. |

Implementation notes (current host APIs):

- The preset probe calls `ctx.permissionPresets.current(agent.session)` — the service takes the **Session** itself (it folds the `permissions` session projection), not `session.events`;
- The listener registers with `{ prepend: true }`. In the Web profile `@deepseek-ai/dsh-api-remotes` forwards `approval/request` to the browser approval panel and awaits the human, and a cordis waterfall stops at the first listener that does not call `next()` — so the claim must not depend on plugin load order;
- `/auto-approve` registers through `ctx.inject(["commands"], …)` instead of racing the command registry at apply time;
- The toggle does **not** use that command. Every `commands.execute` appends a `command/run` + `command/done` pair to the session log, which the chat renders as a permanent `auto-approve · {"mode":…}` row — and the toggle reads the mode on every mount, so the command path left one row per opened session. The host half registers an exact Fetch route with `ctx.connection.fetch.register({ path: "/api/dsh-auto-approve", methods: ["POST"], requestBody: "buffered", fetch })`, and the client half posts `{ endpoint, payload }` to it; the route is unrelated to any session, so nothing is logged. Connection's `/api` prefix route applies the Host/Origin trust fence and the browser-session check before dispatch, so the route only ever runs for an authenticated operator request. A host half that predates the route — or any profile where the route registration never ran — answers with an HTTP status, and the toggle then falls back to the slash command for that page load, printing one `console.warn`, instead of leaving a dead button.
- A Fetch route is used rather than a Connection RPC channel because `ctx.connection.rpc.handle` **cannot mount one at all**: `HostConnectionService`'s `rpc` getter reads `this.ctx`, and cordis routes a service getter's context reads back through the service's own fiber, so the channel's internal `owner.webServer.register(...)` never resolves `webServer` (`cannot get property "webServer" without inject`, measured on 0.1.7-alpha.2 + cordis 4.0.4). The Fetch-route registry writes only into the service's own table and has no such dependency; the first-party equivalent is `@deepseek-ai/dsh-client-ui-deliverables`' `/api/present.open`.
- The toggle's session-agnostic route means the mode is process-local, not per-session — but the legacy command fallback still needs a session, and 0.1.7 removed the field it used. `SessionListState` is now `{ ids, byId, phase, projectionsBySession }` ("view selection remains outside the Controller"), so the on-stage session is read as `Object.values(state.byId).find(s => (s.retainedBy?.mainView ?? 0) > 0)` behind a `state.phase === "ready"` gate — the same idiom the shipped `ui-layout`, `ui-cordis`, `ui-workspace`, `ui-session`, `ui-agent-preset`, and `settings-general` bundles use.
- Rows already written to older sessions are session history, which the plugin must not rewrite — but showing them is a renderer choice. The `conversation.chat.commandview` slot is keyed by command name and its contract states that reusing a key *replaces* that command's renderer, so the client half registers the key `auto-approve` with a hidden marker and ships one stylesheet rule, `[data-chat-flow-kind="command"]:has(.dsh-auto-approve-suppressed){display:none}`. It hides the Chat flow item (the element that owns the inter-item gap, so no blank gap is left behind) rather than only the row wrapper. Both the flow-kind attribute and `:has()` are shell internals: if either disappears, the rule stops matching and the rows simply reappear — no other surface is affected. `/auto-approve` typed by hand is therefore invisible in the chat too; the header button is the visible state.

DSH has `ask` and `never` policies but no native auto-approve policy. This plugin implements auto-approval by short-circuiting the waterfall. `never` means reject, not auto-approve.

## Security

- `all` grants every approval request and is only suitable for trusted tasks.
- Manual mode is process-local and returns to the default `sandbox` mode after restart.
- The Auto approve preset remains constrained to `workspace-write`; requests outside the workspace still use escalation, although this plugin grants the resulting approval.

## Tests

```powershell
# Host half: route path/shape, request envelope, waterfall claim, command switch.
node test/host-route-smoke.mjs

# Client half: the log-free route path, the stale-host fallback, the slot.
node test/client-smoke.mjs
```
