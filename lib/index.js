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
 * session-header button (see `lib/client.js`).
 *
 * Verified against `@deepseek-ai/dsh` 0.1.5-rc.1 (cordis 4.0.2):
 *   - `ApprovalRequestEvent.reason` / `.toolName` and the `allowed-once`
 *     outcome are unchanged, and the host sandbox escalation ask still carries
 *     `escalate sandbox to <mode>: <justification>`, so the `sandbox`
 *     heuristic still matches.
 *   - `ctx.permissionPresets.current(session)` takes the SESSION (it folds the
 *     `permissions` session projection), so the preset probe must pass
 *     `req.agent.session` — the old `session.events` no longer exists and made
 *     the preset branch throw inside its own guard.
 *   - The listener is registered with `{ prepend: true }`: in the Web profile
 *     `@deepseek-ai/dsh-api-remotes` forwards `approval/request` to the browser
 *     approval panel and awaits the human, and a waterfall stops at the first
 *     listener that does not call `next()`. Prepending makes this plugin's
 *     decision independent of loader apply order.
 *
 * @module dsh-auto-approve
 */

/** Plugin identity used by the Loader registry. */
const name = "auto-approve";

/**
 * Manual mode state, process-local (per plugin instance). Modes:
 * `off` | `sandbox` | `all`.
 */
const state = { mode: "sandbox" };

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

  // Human-facing switch: /auto-approve all|sandbox|off|status
  // Through `ctx.inject` (not `ctx.get`) so the command waits for the
  // command registry instead of racing its startup.
  ctx.inject(["commands"], (commandCtx) => {
    commandCtx.commands.register({
      name: "auto-approve",
      description: "切换自动审批模式：auto-approve all（全部自动批准）、sandbox（仅沙箱升级）、off（关闭）、status（查看状态）",
      input: { hint: "all | sandbox | off | status" },
      recordInput: true,
      handler: (invocation) => {
        const arg = String(invocation.rawInput ?? "").trim();
        if (arg === "all" || arg === "on") state.mode = "all";
        else if (arg === "sandbox") state.mode = "sandbox";
        else if (arg === "off") state.mode = "off";
        else if (arg === "status" || arg === "") {
          return { kind: "success", text: JSON.stringify({ mode: state.mode }) };
        } else {
          return { kind: "error", text: "用法: /auto-approve all|sandbox|off|status" };
        }
        return { kind: "success", text: JSON.stringify({ mode: state.mode }) };
      },
    });
  });
}

export { apply, name };
