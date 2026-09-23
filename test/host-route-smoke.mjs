/**
 * Host-half smoke checks for dsh-auto-approve.
 *
 * The point of these checks is the regression the header toggle caused: the
 * mode used to travel over `/auto-approve`, whose every execution appends a
 * `command/run` + `command/done` pair — one permanent `auto-approve` row in the
 * conversation per session open. The mode now travels over the plugin's own
 * authenticated Fetch route, so the assertions below pin:
 *
 *   1. the route path satisfies the Connection `/api` Fetch-route pattern;
 *   2. `status`/`set` answer the result shape and reject junk, and the
 *      request-level envelope gates method and body;
 *   3. the endpoint dispatcher takes no context at all, so it has no session to
 *      write to;
 *   4. the route is registered through `connection.fetch.register` and never
 *      touches `connection.rpc.handle` — the latter cannot resolve `webServer`
 *      from a plugin context and therefore never mounts a channel (measured on
 *      `dsh` 0.1.7-alpha.2 + cordis 4.0.4: `cannot get property "webServer"
 *      without inject`);
 *   5. the human `/auto-approve` command still works (it is now the only path
 *      that logs, and only when a person types it).
 */
import { FETCH_PATH, apply, handleEndpoint, parseMode, serveRequest } from "../lib/index.js";

// 1. The exact Fetch route must live below `/api` and satisfy the segment pattern.
if (!FETCH_PATH.startsWith("/api/")) throw new Error(`route ${JSON.stringify(FETCH_PATH)} must sit below the shared /api channel`);
const routeSegment = FETCH_PATH.slice("/api/".length);
if (!/^[A-Za-z0-9_$.-]+$/.test(routeSegment)) throw new Error(`route segment ${JSON.stringify(routeSegment)} violates the Connection endpoint pattern`);
if (routeSegment.includes("/")) throw new Error("an exact Fetch route owns one path, not a prefix");

// 3. No context parameter: the toggle path cannot reach a Session even by accident.
if (handleEndpoint.length !== 2) throw new Error("handleEndpoint must be (endpoint, payload) with no context — the log-free property is structural");

parseMode("sandbox");
let result = handleEndpoint("status", {});
if (result.ok !== true || result.value.mode !== "sandbox") throw new Error("status did not report the default mode");

result = handleEndpoint("set", { mode: "all" });
if (result.ok !== true || result.value.mode !== "all") throw new Error("set did not switch to all");
if (handleEndpoint("status", {}).value.mode !== "all") throw new Error("status did not observe the switch");

result = handleEndpoint("set", { mode: "on" });
if (result.ok !== true || result.value.mode !== "all") throw new Error("set did not accept the `on` alias");

result = handleEndpoint("set", { mode: "off" });
if (result.ok !== true || result.value.mode !== "off") throw new Error("set did not switch to off");

const badMode = handleEndpoint("set", { mode: "sometimes" });
if (badMode.ok !== false || badMode.error.code !== "auto-approve/unknown-mode") throw new Error("an unknown mode must be an endpoint failure");
const noPayload = handleEndpoint("set", undefined);
if (noPayload.ok !== false) throw new Error("a missing payload must be an endpoint failure");
const unknown = handleEndpoint("nope", {});
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

// 2b. The request-level envelope: method gate, JSON gate, endpoint dispatch.
parseMode("sandbox");
const okResponse = await serveRequest(new Request(`http://127.0.0.1${FETCH_PATH}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ endpoint: "set", payload: { mode: "all" } })
}));
if (okResponse.status !== 200) throw new Error(`POST route answered ${okResponse.status}`);
if (okResponse.headers.get("cache-control") !== "no-store") throw new Error("route replies must not be cached");
const okBody = await okResponse.json();
if (okBody.ok !== true || okBody.value.mode !== "all") throw new Error("the route envelope did not carry the endpoint value");

const getResponse = await serveRequest(new Request(`http://127.0.0.1${FETCH_PATH}`, { method: "GET" }));
if (getResponse.status !== 405) throw new Error("a non-POST route request must be rejected");
const badJsonResponse = await serveRequest(new Request(`http://127.0.0.1${FETCH_PATH}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "not json"
}));
if (badJsonResponse.status !== 400) throw new Error("a non-JSON body must be rejected");

// 4. apply(): approval listener, authenticated Fetch route, human command.
const listeners = [];
const injections = [];
let route = null;
let definition = null;
let rpcTouched = false;
const ctx = {
  on: (event, handler, options) => { listeners.push({ event, handler, options }); },
  get: () => undefined,
  inject: (deps, callback) => {
    injections.push(deps);
    callback({
      connection: {
        fetch: { register: (value) => { route = value; return () => {}; } },
        // 4b. Regression guard: mounting a channel here throws on a live host,
        // so touching this API at all is the failure this plugin already fixed.
        get rpc() { rpcTouched = true; throw new Error("the route must not be mounted through connection.rpc.handle"); }
      },
      commands: { register: (value) => { definition = value; return () => {}; } }
    });
  }
};
apply(ctx);

if (rpcTouched) throw new Error("apply reached for connection.rpc instead of the Fetch-route registry");
if (injections.length !== 2) throw new Error("apply must register exactly the route and the command");
if (injections[0].length !== 1 || injections[0][0] !== "connection") throw new Error("the route registration must wait on connection alone");
if (route === null) throw new Error("the authenticated Fetch route was not registered");
if (route.path !== FETCH_PATH) throw new Error("the route was mounted on the wrong path");
if (!Array.isArray(route.methods) || route.methods.join(",") !== "POST") throw new Error("the route must own POST only");
if (route.requestBody !== "buffered") throw new Error("the route must declare a buffered body");
if (typeof route.fetch !== "function") throw new Error("the route has no fetch implementation");

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

console.log("HOST ROUTE SMOKE CHECKS PASSED");
