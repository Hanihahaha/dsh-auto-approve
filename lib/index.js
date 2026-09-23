/**
 * dsh-auto-approve — auto-approve mode for DeepSeek Harness.
 *
 * The plugin short-circuits the `approval/request` waterfall and returns
 * `allowed-once` without asking the user, in two situations:
 *
 * 1. The session's permission selector is on the `auto-approve` preset
 *    (added by this bundle's patch to the permission-presets table) — every
 *    approval request is auto-granted.
 * 2. The manual mode switch is on: `sandbox` (default) auto-grants only
 *    sandbox-escalation requests, `all` auto-grants everything, `off` restores
 *    the native ask behavior.
 *
 * The mode switch is a human-facing `/auto-approve` command and a
 * session-header button (see `lib/client.js`). The button does NOT use the
 * command: every `commands.execute` appends a `command/run` + `command/done`
 * pair to the session log, and the chat renders that pair as a permanent
 * `auto-approve · {"mode":…}` row. The button polls the mode on mount, so the
 * command path used to add one row per session open. It now talks to the
 * dedicated authenticated Fetch route below, which logs nothing.
 *
 * Verified against `@deepseek-ai/dsh` 0.1.7-alpha.2 (cordis 4.0.4):
 *   - `ApprovalRequestEvent.reason` / `.toolName` and the `allowed-once`
 *     outcome are unchanged, `{ prepend: true }` is still a cordis listener
 *     option, and the host sandbox escalation ask still carries
 *     `escalate sandbox to <mode>: <justification>`, so the `sandbox`
 *     heuristic still matches.
 *   - `ctx.permissionPresets.current(session)` still takes the SESSION (it folds
 *     the `permissions` session projection), so the preset probe passes
 *     `req.agent.session`. The live 0.1.7 catalog reports the patched
 *     `auto-approve` entry, and switching to it still records only the preset
 *     identity because its knob bundle matches `workspace-write` — which is what
 *     makes `current(session)` resolve back to `auto-approve`.
 *   - The route is registered through `ctx.connection.fetch.register`, NOT
 *     `ctx.connection.rpc.handle`. `HostConnectionService`'s `rpc` getter reads
 *     `this.ctx`, and cordis routes a service getter's context reads back
 *     through the service's own fiber, so `rpc.handle`'s internal
 *     `owner.webServer.register(...)` can never resolve `webServer` from a
 *     plugin context — it throws `cannot get property "webServer" without
 *     inject` on 0.1.7-alpha.2 + cordis 4.0.4 (measured). The Fetch-route
 *     registry only writes into the service's own table, and the `/api` prefix
 *     route that dispatches it already applies the Host/Origin trust fence and
 *     the browser-session check.
 *
 * @module dsh-auto-approve
 */

/** Plugin identity used by the Loader registry. */
const name = "auto-approve";

/**
 * Authenticated Fetch route owned by this plugin's browser half.
 *
 * Absolute below the shared `/api` channel, so Connection's trust fence and
 * browser-session check run before `serveRequest` is ever reached. The path
 * segment must satisfy the Connection wire pattern `[A-Za-z0-9_$.-]+`.
 */
const FETCH_PATH = "/api/dsh-auto-approve";

/** Route replies carry process-local state and must never be cached. */
const NO_STORE_HEADERS = { "cache-control": "no-store" };

/**
 * Manual mode state, process-local (per plugin instance). Modes:
 * `off` | `sandbox` | `all`.
 */
const state = { mode: "sandbox" };

/**
 * Apply one mode word, the single write path shared by the command and the
 * browser toggle.
 * @param raw - user- or wire-supplied mode word.
 * @returns the resulting mode, or undefined when the word is not a mode.
 */
function parseMode(raw) {
  const value = String(raw ?? "").trim();
  if (value === "all" || value === "on") state.mode = "all";
  else if (value === "sandbox") state.mode = "sandbox";
  else if (value === "off") state.mode = "off";
  else return undefined;
  return state.mode;
}

/** One successful route result. */
function rpcOk(value) {
  return { ok: true, value };
}

/** One failed route result (carrier-neutral failure shape). */
function rpcFail(code, message) {
  return { ok: false, error: { code, message, details: {} } };
}

/**
 * Serve one route endpoint.
 *
 * `status` reads the mode and `set` writes it; both are ordinary unary
 * endpoints. Nothing here touches a session — which is why the route needs no
 * session identity in its payload and why the toggle leaves no
 * `command/run` + `command/done` entries in the conversation.
 * @param endpoint - route-relative endpoint name.
 * @param payload - endpoint-owned request payload.
 * @returns the result envelope for this endpoint.
 */
function handleEndpoint(endpoint, payload) {
  if (endpoint === "status") return rpcOk({ mode: state.mode });
  if (endpoint === "set") {
    const mode = parseMode(payload?.mode);
    if (mode === undefined) return rpcFail("auto-approve/unknown-mode", `unknown mode ${JSON.stringify(payload?.mode)} (expected all | sandbox | off)`);
    return rpcOk({ mode });
  }
  return rpcFail("auto-approve/unknown-endpoint", `unknown endpoint ${JSON.stringify(endpoint)}`);
}

/**
 * Answer one request on {@link FETCH_PATH}.
 *
 * The `/api` prefix route has already applied the trust fence, the browser
 * authentication check, and the buffered-body cap before dispatching here, so
 * this handler validates only what it owns: the method, the JSON body, and the
 * endpoint.
 * @param request - the authenticated request.
 * @returns the JSON envelope the browser half parses.
 */
async function serveRequest(request) {
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: NO_STORE_HEADERS });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("body is not JSON", { status: 400, headers: NO_STORE_HEADERS });
  }
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  return Response.json(handleEndpoint(endpoint, body?.payload), { headers: NO_STORE_HEADERS });
}

/**
 * Resolve the session's effective permission preset for one approval request.
 * Reads through `ctx.permissionPresets.current(session)`; failures return
 * undefined so the waterfall falls through to normal policy.
 * @param ctx - the plugin context.
 * @param req - the pending ApprovalRequest (its agent carries the session).
 * @returns the effective preset name, or undefined when unreadable.
 */
function presetOf(ctx, req) {
  try {
    const permission = ctx.get("permissionPresets");
    const session = req?.agent?.session;
    if (permission === undefined || session === undefined) return undefined;
    return permission.current(session);
  } catch {
    return undefined;
  }
}

/** Whether one reason string is a sandbox-escalation request. */
function isSandboxReason(reason) {
  return reason.includes("escalate sandbox") || reason.includes("sandbox");
}

function apply(ctx) {
  // Intercept the approval waterfall. Returning an outcome here claims the
  // request and skips the composed answerers (and the user prompt). Prepending
  // keeps that claim ahead of the Web UI's forwarded answerer, which otherwise
  // blocks on a human decision before this listener ever runs.
  ctx.on("approval/request", (req, next) => {
    const reason = typeof req?.reason === "string" ? req.reason : "";
    const toolName = typeof req?.toolName === "string" ? req.toolName : "?";

    // Permission selector on the "auto-approve" preset: auto-grant everything.
    if (presetOf(ctx, req) === "auto-approve") {
      console.log(`[auto-approve] auto-granted (preset=auto-approve) tool=${toolName} reason=${reason}`);
      return Promise.resolve("allowed-once");
    }

    const mode = state.mode;
    if (mode === "off") return next();
    if (mode === "all" || (mode === "sandbox" && isSandboxReason(reason))) {
      console.log(`[auto-approve] auto-granted (${mode}) tool=${toolName} reason=${reason}`);
      return Promise.resolve("allowed-once");
    }
    return next();
  }, { prepend: true });

  // Browser half's private wire: the session-header toggle reads and writes the
  // mode here. Waiting on `connection` keeps the registration a no-op in a
  // profile that composes no Web carrier.
  ctx.inject(["connection"], (connectionCtx) => {
    connectionCtx.connection.fetch.register({
      path: FETCH_PATH,
      methods: ["POST"],
      requestBody: "buffered",
      fetch: serveRequest,
    });
  });

  // Human-facing switch: /auto-approve all|sandbox|off|status
  // Through `ctx.inject` (not `ctx.get`) so the command waits for the
  // command registry instead of racing its startup.
  ctx.inject(["commands"], (commandCtx) => {
    commandCtx.commands.register({
      name: "auto-approve",
      description: "切换自动审批模式：auto-approve all（全部自动批准）、sandbox（仅沙箱升级）、off（关闭）、status（查看状态）",
      input: { hint: "all | sandbox | off | status" },
      // The mode is this command's whole payload and it is already visible in
      // the settlement text, so the log keeps only `name` + outcome.
      recordInput: false,
      handler: (invocation) => {
        const arg = String(invocation.rawInput ?? "").trim();
        if (arg === "" || arg === "status") {
          return { kind: "success", text: JSON.stringify({ mode: state.mode }) };
        }
        const mode = parseMode(arg);
        if (mode === undefined) return { kind: "error", text: "用法: /auto-approve all|sandbox|off|status" };
        return { kind: "success", text: JSON.stringify({ mode }) };
      },
    });
  });
}

export { FETCH_PATH, apply, handleEndpoint, name, parseMode, serveRequest };
