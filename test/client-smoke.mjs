/**
 * Client-half smoke checks for dsh-auto-approve.
 *
 * The header toggle must reach the host over its private Connection RPC channel
 * and must NOT execute `/auto-approve` commands, because every command call
 * appends a `command/run` + `command/done` pair that the chat renders as a
 * permanent `auto-approve` row. The legacy command transport survives only for
 * a host half older than the channel, and must be adopted once per page.
 */
import { readFileSync } from "node:fs";

const code = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
let record;
const windowShim = { __ModuleLoader__: { load: (value) => { record = value; } } };
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {}
};
const requireShim = (specifier) => {
  if (specifier === "react") return react;
  throw new Error("unexpected require: " + specifier);
};
new Function("window", "require", code)(windowShim, requireShim);
if (!record || record.id !== "dsh-auto-approve") throw new Error("client bundle did not register");
const plugin = record.factory(requireShim);
if (typeof plugin.apply !== "function" || typeof plugin.createModeApi !== "function") throw new Error("client exports are incomplete");
if (typeof plugin.createCommandRunner !== "function") throw new Error("the legacy command runner is missing");
if (!plugin.inject.includes("connection")) throw new Error("the client half must inject the Connection carrier");

/** A client plugin context: `sessions`, `remote.commands`, `slots`, and no `connection`. */
function clientCtx() {
  const commandCalls = [];
  const ctx = {
    get: (key) => key === "sessions"
      ? { list: { getSnapshot: () => ({ current: "session-1" }) } }
      : key === "slots"
        ? { inject: () => {}, register: () => () => {} }
        : undefined,
    remote: {
      commands: {
        execute: async (sessionId, line, attachments) => {
          commandCalls.push({ sessionId, line, attachments });
          return { ok: true, value: { result: { kind: "success", text: JSON.stringify({ mode: "sandbox" }) } } };
        }
      }
    }
  };
  return { ctx, commandCalls };
}

// 1. Channel available: both reads and writes stay off the command channel.
const rpcCalls = [];
const rpc = { call: async (channel, endpoint, payload) => { rpcCalls.push({ channel, endpoint, payload }); return { ok: true, value: { mode: endpoint === "set" ? payload.mode : "all" } }; } };
const primary = clientCtx();
const primaryApi = plugin.createModeApi({ rpc, runCommand: plugin.createCommandRunner(primary.ctx) });
const status = await primaryApi.status();
if (status.ok !== true || status.data.mode !== "all") throw new Error("status did not read the mode from the private channel");
const switched = await primaryApi.set("off");
if (switched.ok !== true || switched.data.mode !== "off") throw new Error("set did not write the mode over the private channel");
if (rpcCalls.length !== 2) throw new Error("the toggled mode must use exactly one channel call per action");
if (rpcCalls[0].channel !== plugin.RPC_CHANNEL || rpcCalls[0].endpoint !== "status") throw new Error("status used the wrong channel or endpoint");
if (rpcCalls[1].endpoint !== "set" || rpcCalls[1].payload.mode !== "off") throw new Error("set used the wrong endpoint or payload");
if (primary.commandCalls.length !== 0) throw new Error("the toggle executed a command while the private channel answered — that is the session-log regression");

const rejected = await plugin.createModeApi({ rpc: { call: async () => ({ ok: false, error: { code: "auto-approve/unknown-mode", message: "nope" } }) }, runCommand: plugin.createCommandRunner(primary.ctx) }).set("sometimes");
if (rejected.ok !== false || !rejected.error.startsWith("auto-approve/unknown-mode")) throw new Error("an endpoint failure must surface as an error, not as a transport fallback");

// 2. Channel unavailable (host half predates it): fall back to the command once.
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => { warnings.push(args); };
let legacyApi;
let legacy;
try {
  legacy = clientCtx();
  legacyApi = plugin.createModeApi({
    rpc: { call: async () => { throw new Error("transport failure for /dsh-auto-approve/status: HTTP 404"); } },
    runCommand: plugin.createCommandRunner(legacy.ctx)
  });
  const legacyStatus = await legacyApi.status();
  await legacyApi.set("all");
  if (legacyStatus.ok !== true || legacyStatus.data.mode !== "sandbox") throw new Error("the legacy status read did not parse the command result");
  if (legacy.commandCalls.length !== 2) throw new Error("the fallback must use the command transport");
  if (legacy.commandCalls[0].line !== "/auto-approve status") throw new Error("the fallback used the wrong status line");
  if (legacy.commandCalls[0].sessionId !== "session-1" || !Array.isArray(legacy.commandCalls[0].attachments)) throw new Error("the fallback must send the session id and an attachment list");
  if (legacy.commandCalls[1].line !== "/auto-approve all") throw new Error("the fallback used the wrong set line");
} finally {
  console.warn = originalWarn;
}
if (warnings.length !== 1) throw new Error("the stale host half must be reported exactly once per page");

// 3. No connection service at all: same fallback, no crash.
const bare = clientCtx();
const bareApi = plugin.createModeApi({ rpc: undefined, runCommand: plugin.createCommandRunner(bare.ctx) });
await bareApi.status();
if (bare.commandCalls.length !== 1) throw new Error("a missing carrier must fall back to the command transport");

// 4. apply() registers the session-header action and suppresses the command row.
const registered = [];
const injected = [];
const slots = {
  inject: (name, callback) => { injected.push(name); callback(); },
  register: (options, component) => { registered.push({ options, component }); return () => {}; }
};
plugin.apply({
  get: (key) => key === "connection"
    ? { rpc }
    : key === "sessions"
      ? { list: { getSnapshot: () => ({ current: "session-1" }) } }
      : key === "slots"
        ? slots
        : undefined,
  remote: { commands: { execute: async () => ({ ok: true, value: { result: { kind: "success", text: "{}" } } }) } }
});
if (injected.join(",") !== "conversation.session.header.actions,conversation.chat.commandview") throw new Error("the header action and command-row slots were not injected");
const action = registered.find((entry) => entry.options.id === "auto-approve");
if (action === undefined || action.options.name !== "conversation.session.header.actions") throw new Error("the header action was not registered");
if (typeof action.component !== "function") throw new Error("the header action has no component");

// 5. The row suppression replaces the command-name-keyed renderer, and the rule
//    hides the enclosing Chat flow item (the element that owns the flow gap).
const rowView = registered.find((entry) => entry.options.name === "conversation.chat.commandview");
if (rowView === undefined || rowView.options.key !== plugin.COMMAND_NAME) throw new Error("the auto-approve command row renderer was not replaced");
const marker = rowView.component({});
if (marker === null || marker.props.hidden !== true || marker.props.className !== "dsh-auto-approve-suppressed") throw new Error("the command row renderer must render the hidden suppression marker");
if (!plugin.ROW_STYLES.includes('[data-chat-flow-kind="command"]')) throw new Error("the suppression rule must be scoped to the command chat flow items");
if (!plugin.ROW_STYLES.includes(":has(.dsh-auto-approve-suppressed)")) throw new Error("the suppression rule must be keyed on the marker, not on every command row");
if (!plugin.ROW_STYLES.includes("display:none")) throw new Error("the suppression rule must remove the flow item, gap included");

console.log("CLIENT SMOKE CHECKS PASSED");
