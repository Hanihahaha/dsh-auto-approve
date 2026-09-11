/**
 * Host-half smoke checks for dsh-auto-approve.
 *
 * The point of these checks is the regression the header toggle caused: the
 * mode used to travel over `/auto-approve`, whose every execution appends a
 * `command/run` + `command/done` pair — one permanent `auto-approve` row in the
 * conversation per session open. The mode now travels over a private Connection
 * RPC channel, so the assertions below pin:
 *
 *   1. the channel name satisfies the Connection wire pattern;
 *   2. `status`/`set` answer the Connection result shape and reject junk;
 *   3. the RPC handler takes no context at all, so it has no session to write to;
 *   4. the human `/auto-approve` command still works (it is now the only path
 *      that logs, and only when a person types it).
 */
import { RPC_CHANNEL, apply, parseMode, rpcHandler } from "../lib/index.js";

if (!/^\/[A-Za-z0-9._~-]+$/.test(RPC_CHANNEL)) throw new Error(`channel ${JSON.stringify(RPC_CHANNEL)} violates the Connection channel pattern`);
if (RPC_CHANNEL === "/api") throw new Error("the shared /api channel belongs to api-gateway");
for (const endpoint of ["status", "set"]) {
  if (!/^[A-Za-z0-9_$.-]+$/.test(endpoint)) throw new Error(`endpoint ${endpoint} violates the Connection endpoint pattern`);
}

// 3. No context parameter: the toggle path cannot reach a Session even by accident.
if (rpcHandler.length !== 2) throw new Error("rpcHandler must be (endpoint, payload) with no context — the log-free property is structural");

parseMode("sandbox");
let result = await rpcHandler("status", {});
if (result.ok !== true || result.value.mode !== "sandbox") throw new Error("status did not report the default mode");

result = await rpcHandler("set", { mode: "all" });
if (result.ok !== true || result.value.mode !== "all") throw new Error("set did not switch to all");
if ((await rpcHandler("status", {})).value.mode !== "all") throw new Error("status did not observe the switch");

result = await rpcHandler("set", { mode: "on" });
if (result.ok !== true || result.value.mode !== "all") throw new Error("set did not accept the `on` alias");

result = await rpcHandler("set", { mode: "off" });
if (result.ok !== true || result.value.mode !== "off") throw new Error("set did not switch to off");

const badMode = await rpcHandler("set", { mode: "sometimes" });
if (badMode.ok !== false || badMode.error.code !== "auto-approve/unknown-mode") throw new Error("an unknown mode must be an endpoint failure");
const noPayload = await rpcHandler("set", undefined);
if (noPayload.ok !== false) throw new Error("a missing payload must be an endpoint failure");
const unknown = await rpcHandler("nope", {});
if (unknown.ok !== false || unknown.error.code !== "auto-approve/unknown-endpoint") throw new Error("an unknown endpoint must be an endpoint failure");
for (const failure of [badMode, noPayload, unknown]) {
  // The browser parser rejects a result whose failure lacks a string code/message
  // and an object `details`, so every failure has to carry the full shape.
  if (typeof failure.error.code !== "string" || typeof failure.error.message !== "string") throw new Error("failure is missing code/message");
  if (typeof failure.error.details !== "object" || failure.error.details === null) throw new Error("failure is missing details");
}

// The command handler never returns the raw state object: HTTP responses must
// stay JSON-serializable, so `parseMode` hands back the mode string only.
if (parseMode("sandbox") !== "sandbox" || parseMode("nonsense") !== undefined) throw new Error("parseMode did not narrow to the mode string");

// 4. apply(): approval listener, private channel, human command.
const listeners = [];
const injections = [];
let channel = null;
let definition = null;
const ctx = {
  on: (event, handler, options) => { listeners.push({ event, handler, options }); },
  get: () => undefined,
  inject: (deps, callback) => {
    injections.push(deps);
    callback({
      connection: { rpc: { handle: (name, handler) => { channel = { name, handler }; return () => {}; } } },
      webServer: {},
      commands: { register: (value) => { definition = value; return () => {}; } }
    });
  }
};
apply(ctx);

if (injections.length !== 2) throw new Error("apply must register exactly the private channel and the command");
if (!injections[0].includes("connection") || !injections[0].includes("webServer")) throw new Error("the channel registration must wait for connection and webServer");
if (channel === null || channel.name !== RPC_CHANNEL) throw new Error("the private channel was not mounted");
if (typeof channel.handler !== "function") throw new Error("the private channel has no handler");

const approval = listeners.find((entry) => entry.event === "approval/request");
if (approval === undefined || approval.options?.prepend !== true) throw new Error("the approval listener must prepend to claim requests before the human panel");

if (definition === null || definition.name !== "auto-approve") throw new Error("the /auto-approve command is missing");
if (definition.recordInput !== false) throw new Error("the command must not log its own input: the settlement text already carries the mode");

parseMode("all");
let nextCalled = false;
const claimed = await approval.handler({ reason: "escalate sandbox to danger-full-access: need it", toolName: "pwsh" }, () => { nextCalled = true; });
if (claimed !== "allowed-once" || nextCalled) throw new Error("`all` mode must claim the request without asking");

parseMode("off");
nextCalled = false;
const released = await approval.handler({ reason: "escalate sandbox to danger-full-access: need it", toolName: "pwsh" }, () => { nextCalled = true; return Promise.resolve("denied"); });
if (released !== "denied" || nextCalled !== true) throw new Error("`off` mode must fall through to the composed answerers");

parseMode("sandbox");
nextCalled = false;
const sandboxOnly = await approval.handler({ reason: "read outside the workspace", toolName: "read" }, () => { nextCalled = true; return Promise.resolve("denied"); });
if (sandboxOnly !== "denied" || nextCalled !== true) throw new Error("`sandbox` mode must not claim a non-sandbox request");

const commandResult = definition.handler({ rawInput: "sandbox" });
if (commandResult.kind !== "success" || JSON.parse(commandResult.text).mode !== "sandbox") throw new Error("the command did not switch the mode");
const commandStatus = definition.handler({ rawInput: "status" });
if (commandStatus.kind !== "success" || JSON.parse(commandStatus.text).mode !== "sandbox") throw new Error("the command did not report the mode");
const commandBad = definition.handler({ rawInput: "whatever" });
if (commandBad.kind !== "error") throw new Error("the command accepted an unknown mode");

console.log("HOST RPC SMOKE CHECKS PASSED");
