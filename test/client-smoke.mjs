/**
 * Client-half smoke checks for dsh-auto-approve.
 *
 * The header toggle must reach the host over the plugin's own authenticated
 * Fetch route and must NOT execute `/auto-approve` commands, because every
 * command call appends a `command/run` + `command/done` pair that the chat
 * renders as a permanent `auto-approve` row. The legacy command transport
 * survives only for a host half older than the route, must be adopted once per
 * page, and must be able to name the on-stage session under the 0.1.7 sessions
 * API — which no longer exposes `list.getSnapshot().current`.
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
if (typeof plugin.currentSessionOf !== "function") throw new Error("the on-stage session reader is missing");
if (!plugin.inject.includes("connection")) throw new Error("the client half must inject the Connection carrier");
if (plugin.FETCH_PATH !== "/api/dsh-auto-approve") throw new Error("the client half targets the wrong route");

/**
 * A 0.1.7-shaped session list: a catalog with `phase`/`byId` and NO `current`,
 * where the on-stage session is the one the main view retains.
 */
function listState({ phase = "ready", retained = true } = {}) {
  return {
    phase,
    ids: ["session-1"],
    byId: {
      "session-1": { id: "session-1", retainedBy: retained ? { mainView: 1 } : {} }
    },
    projectionsBySession: {}
  };
}

/** A client plugin context: `sessions`, `remote.commands`, `slots`, and no `connection`. */
function clientCtx({ phase = "ready", retained = true } = {}) {
  const commandCalls = [];
  const ctx = {
    get: (key) => key === "sessions"
      ? { list: { getSnapshot: () => listState({ phase, retained }) } }
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

/** Install one `fetch` shim for the duration of a callback. */
async function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const routeCalls = [];
const routeFetch = async (url, init) => {
  const body = JSON.parse(init.body);
  routeCalls.push({ url, method: init.method, ...body });
  // Mirror the host endpoint: an unknown mode is an endpoint failure, which is
  // an answer (HTTP 200 with `ok: false`), not a transport failure.
  if (body.endpoint === "set" && !["all", "on", "sandbox", "off"].includes(body.payload?.mode)) {
    return new Response(JSON.stringify({ ok: false, error: { code: "auto-approve/unknown-mode", message: `unknown mode ${JSON.stringify(body.payload?.mode)}` } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  return new Response(JSON.stringify({ ok: true, value: { mode: body.endpoint === "set" ? body.payload.mode : "all" } }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

// 1. Route available: both reads and writes stay off the command channel.
await withFetch(routeFetch, async () => {
  const primary = clientCtx();
  const primaryApi = plugin.createModeApi({ call: plugin.callRoute, runCommand: plugin.createCommandRunner(primary.ctx) });
  const status = await primaryApi.status();
  if (status.ok !== true || status.data.mode !== "all") throw new Error("status did not read the mode from the route");
  const switched = await primaryApi.set("off");
  if (switched.ok !== true || switched.data.mode !== "off") throw new Error("set did not write the mode over the route");
  if (routeCalls.length !== 2) throw new Error("the toggled mode must use exactly one route call per action");
  if (routeCalls[0].url !== plugin.FETCH_PATH || routeCalls[0].endpoint !== "status") throw new Error("status used the wrong route or endpoint");
  if (routeCalls[1].endpoint !== "set" || routeCalls[1].payload.mode !== "off") throw new Error("set used the wrong endpoint or payload");
  if (primary.commandCalls.length !== 0) throw new Error("the toggle executed a command while the route answered — that is the session-log regression");

  // An endpoint-level failure is an answer, not a transport failure: no fallback.
  const rejected = await plugin.createModeApi({
    call: plugin.callRoute,
    runCommand: plugin.createCommandRunner(primary.ctx)
  }).set("sometimes");
  if (rejected.ok !== false || !rejected.error.startsWith("auto-approve/unknown-mode")) throw new Error("an endpoint failure must surface as an error, not as a transport fallback");
  if (primary.commandCalls.length !== 0) throw new Error("an endpoint failure must not fall back to the command transport");
});

// 2. Route unavailable (host half predates it): fall back to the command once.
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => { warnings.push(args); };
let legacy;
try {
  legacy = clientCtx();
  await withFetch(async () => new Response("not found", { status: 404 }), async () => {
    const legacyApi = plugin.createModeApi({ call: plugin.callRoute, runCommand: plugin.createCommandRunner(legacy.ctx) });
    const legacyStatus = await legacyApi.status();
    await legacyApi.set("all");
    if (legacyStatus.ok !== true || legacyStatus.data.mode !== "sandbox") throw new Error("the legacy status read did not parse the command result");
  });
} finally {
  console.warn = originalWarn;
}
if (legacy.commandCalls.length !== 2) throw new Error("the fallback must use the command transport");
if (legacy.commandCalls[0].line !== "/auto-approve status") throw new Error("the fallback used the wrong status line");
if (legacy.commandCalls[0].sessionId !== "session-1" || !Array.isArray(legacy.commandCalls[0].attachments)) throw new Error("the fallback must send the session id and an attachment list");
if (legacy.commandCalls[1].line !== "/auto-approve all") throw new Error("the fallback used the wrong set line");
if (warnings.length !== 1) throw new Error("the stale host half must be reported exactly once per page");

// 2b. The 0.1.7 sessions regression: `list.getSnapshot()` has no `current`, so
//     the session must come from the main-view retention count instead.
const sessionsShim = clientCtx();
const resolved = plugin.currentSessionOf(sessionsShim.ctx.get("sessions"));
if (resolved === undefined || resolved.id !== "session-1") throw new Error("the on-stage session was not resolved from the 0.1.7 catalog shape");
if (plugin.currentSessionOf({ list: { getSnapshot: () => listState({ retained: false }) } }) !== undefined) throw new Error("an unreferenced session must not be reported as on-stage");
if (plugin.currentSessionOf({ list: { getSnapshot: () => listState({ phase: "loading" }) } }) !== undefined) throw new Error("a catalog that has not finished its first pull must not report a session");
const noCurrent = clientCtx();
const noCurrentLine = await withFetch(async () => new Response("not found", { status: 404 }), async () =>
  plugin.createCommandRunner(noCurrent.ctx)("/auto-approve status"));
if (noCurrentLine.ok !== true || noCurrentLine.data.mode !== "sandbox") throw new Error("the legacy transport cannot name a session under the 0.1.7 sessions API");

// 3. A rejected transport (no route at all): same fallback, no crash.
const bare = clientCtx();
const bareApi = plugin.createModeApi({ call: plugin.callRoute, runCommand: plugin.createCommandRunner(bare.ctx) });
await withFetch(async () => { throw new Error("network down"); }, async () => {
  const originalWarn2 = console.warn;
  console.warn = () => {};
  try {
    await bareApi.status();
  } finally {
    console.warn = originalWarn2;
  }
});
if (bare.commandCalls.length !== 1) throw new Error("a missing route must fall back to the command transport");

// 4. apply() registers the session-header action and suppresses the command row.
const registered = [];
const injected = [];
const slots = {
  inject: (name, callback) => { injected.push(name); callback(); },
  register: (options, component) => { registered.push({ options, component }); return () => {}; }
};
plugin.apply({
  get: (key) => key === "sessions"
    ? { list: { getSnapshot: () => listState() } }
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
