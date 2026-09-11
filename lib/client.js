// dsh-auto-approve browser bundle (hand-built lazy-CJS plugin).
// The web shell's ClientModuleLoader executes this file as a classic script:
// window.__ModuleLoader__.load({ id, factory }) only REGISTERS the factory;
// materialization runs factory(require) and memoizes the exports. The module
// table resolves bare specifiers (react, @deepseek-ai/*) to other registered
// client bundles or the shell's static registry.
//
// The client half renders a small session-header toggle that reads and
// switches the auto-approve mode. It does NOT go through the host's
// `/auto-approve` command: `commands.execute` appends a `command/run` +
// `command/done` pair to the session log, which the chat renders as a
// permanent `auto-approve · {"mode":…}` row — and this toggle polls on every
// mount, so the command path left one such row per opened session. The modes
// travel over the plugin's own Connection RPC channel instead
// (`ctx.connection.rpc.call("/dsh-auto-approve", endpoint, payload)`), which
// writes no session events at all.
//
// A host half that predates the channel — or any profile where the channel
// registration never ran — refuses it. `@deepseek-ai/dsh-client-modules`
// snapshots client bundles at boot and the profile's live patch reload watches
// patch files rather than plugin code, so both halves normally change together
// on the next `dsh web` start; the fallback below covers the skew instead of
// leaving a dead button, and reports itself once per page load.
window.__ModuleLoader__.load({
  id: "dsh-auto-approve",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let React = require("react");

    const inject = ["slots", "connection", "remote", "remote.commands", "sessions"];

    /** The channel `lib/index.js` mounts for this bundle. */
    const RPC_CHANNEL = "/dsh-auto-approve";

    /** The host command this plugin registers, and the chat row keyed by it. */
    const COMMAND_NAME = "auto-approve";

    /**
     * Marker class the suppression stylesheet matches, and the rule itself.
     *
     * `commands.execute` has always appended `command/run` + `command/done` to
     * the session log, so sessions opened before the private channel existed
     * still carry their `auto-approve · {"mode":…}` rows — they are session
     * history and nothing in this plugin may rewrite it. What the chat shows is
     * a renderer choice, though: the `conversation.chat.commandview` slot is
     * keyed by command name and its own contract says reusing a key replaces
     * that command's renderer, so this bundle replaces it with a hidden marker
     * and hides the enclosing Chat flow item.
     *
     * The flow item is the chat column's direct child (`data-chat-flow-kind` is
     * its kind attribute) and is the element that carries the inter-item gap, so
     * hiding only the row's own wrapper would leave one blank gap per row. If a
     * future shell drops either the attribute or `:has()`, this rule simply
     * stops matching: the rows come back, and nothing else changes.
     */
    const SUPPRESSED_ROW_CLASS = "dsh-auto-approve-suppressed";
    const ROW_STYLES = '[data-chat-flow-kind="command"]:has(.' + SUPPRESSED_ROW_CLASS + "){display:none}";
    const ROW_STYLE_TAG_ID = "dsh-auto-approve/rows";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css='" + ROW_STYLE_TAG_ID + "']") === null) {
      const styleTag = document.createElement("style");
      styleTag.dataset.plugin = "dsh-auto-approve";
      styleTag.dataset.pluginCss = ROW_STYLE_TAG_ID;
      styleTag.textContent = ROW_STYLES;
      document.head.appendChild(styleTag);
    }

    /**
     * Legacy transport: run one machine command against the current session;
     * returns parsed JSON. The typed Remote signature is
     * `commands.execute(agentId, line, submittedAttachments)` — an untagged
     * client context (this plugin) is NOT projected onto the agent scope, so
     * all three business arguments are required and omitting the attachment
     * list is rejected client-side.
     *
     * Every call appends `command/run` + `command/done` to the session, which
     * the chat renders as one `auto-approve` row, so this path is only reached
     * when the private channel is unavailable.
     * @param ctx - the client plugin context owning `sessions`/`remote`.
     * @returns command runner mapping one slash line to `{ ok, data }`/`{ ok, error }`.
     */
    function createCommandRunner(ctx) {
      const sessions = ctx.get("sessions");
      return async (line) => {
        const sessionId = sessions.list.getSnapshot().current;
        if (sessionId === void 0) return { ok: false, error: "no active session" };
        let result;
        try {
          result = await ctx.remote.commands.execute(sessionId, line, []);
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
        if (!result.ok) return { ok: false, error: `${result.error.code}: ${result.error.message}` };
        const value = result.value;
        if (value === void 0) return { ok: false, error: `unknown command: ${line}` };
        if (value.result.kind === "error") return { ok: false, error: value.result.text ?? "command failed" };
        try {
          return { ok: true, data: JSON.parse(value.result.text) };
        } catch {
          return { ok: false, error: value.result.text ?? "unparsable response" };
        }
      };
    }

    /**
     * Build the mode read/write pair the header toggle renders.
     *
     * The private Connection channel is the primary transport. A channel-level
     * failure (a host half that predates the channel, a dropped connection) is
     * not an endpoint failure: it moves the page onto the legacy transport
     * — which works everywhere but adds one row per call — instead of leaving a
     * dead button, and stays there.
     * @param rpc - `ctx.connection.rpc`, the generic Connection caller.
     * @param runCommand - legacy command runner from {@link createCommandRunner}.
     * @returns `status()` and `set(mode)`, each resolving to the wire shapes above.
     */
    function createModeApi({ rpc, runCommand }) {
      /** Whether this page already settled on the legacy command transport. */
      let commandFallback = false;

      const call = async (endpoint, payload) => {
        if (rpc !== undefined && !commandFallback) {
          try {
            const result = await rpc.call(RPC_CHANNEL, endpoint, payload);
            if (!result.ok) return { ok: false, error: `${result.error.code}: ${result.error.message}` };
            return { ok: true, data: result.value };
          } catch (error) {
            commandFallback = true;
            console.warn("[auto-approve] the private channel did not answer; the header toggle falls back to /auto-approve, which adds one conversation row per call. Restart `dsh web` and reload the page to pick up the log-free host half.", error);
          }
        }
        commandFallback = true;
        return endpoint === "status"
          ? runCommand("/auto-approve status")
          : runCommand(`/auto-approve ${String(payload.mode)}`);
      };

      return {
        status: () => call("status", {}),
        set: (mode) => call("set", { mode })
      };
    }

    function apply(ctx) {
      const api = createModeApi({
        rpc: ctx.get("connection")?.rpc,
        runCommand: createCommandRunner(ctx)
      });

      function AutoApproveButton() {
        const [mode, setMode] = React.useState("sandbox");
        React.useEffect(() => {
          let alive = true;
          api.status().then((r) => {
            if (!alive) return;
            if (r.ok && r.data && typeof r.data.mode === "string") setMode(r.data.mode);
            else console.error("[auto-approve] status failed:", r.error);
          }).catch(() => {});
          return () => { alive = false; };
        }, []);
        const cycle = () => {
          const next = mode === "off" ? "sandbox" : mode === "sandbox" ? "all" : "off";
          api.set(next).then((r) => {
            if (r.ok && r.data && typeof r.data.mode === "string") setMode(r.data.mode);
            else console.error("[auto-approve] switch failed:", r.error);
          }).catch(() => {});
        };
        const label = mode === "off" ? "审批:关" : mode === "sandbox" ? "审批:沙箱" : "审批:全部";
        const title = mode === "off"
          ? "自动审批关闭，点击切换"
          : mode === "sandbox"
            ? "仅自动批准沙箱权限升级，点击切换"
            : "自动批准所有审批，点击切换";
        return React.createElement("button", {
          onClick: cycle,
          title,
          style: {
            cursor: "pointer",
            fontSize: "12px",
            color: "var(--dsw-alias-label-secondary)",
            background: "transparent",
            border: "none",
            padding: "4px 6px"
          }
        }, label);
      }

      const slots = ctx.get("slots");
      if (slots !== undefined) {
        slots.inject("conversation.session.header.actions", () => slots.register(
          { name: "conversation.session.header.actions", id: "auto-approve", order: 20 },
          AutoApproveButton,
        ));
        // Replace the command row's renderer with a hidden marker (see ROW_STYLES):
        // the mode is a header-button state, not conversation content.
        slots.inject("conversation.chat.commandview", () => slots.register(
          { name: "conversation.chat.commandview", key: COMMAND_NAME },
          AutoApproveRowSuppressor,
        ));
      }
    }

    /** Renders nothing visible; exists only so {@link ROW_STYLES} can find its flow item. */
    function AutoApproveRowSuppressor() {
      return React.createElement("span", { className: SUPPRESSED_ROW_CLASS, hidden: true });
    }

    exports.COMMAND_NAME = COMMAND_NAME;
    exports.ROW_STYLES = ROW_STYLES;
    exports.RPC_CHANNEL = RPC_CHANNEL;
    exports.apply = apply;
    exports.createCommandRunner = createCommandRunner;
    exports.createModeApi = createModeApi;
    exports.inject = inject;
    return module.exports;
  }
});
