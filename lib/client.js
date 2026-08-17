// dsh-auto-approve browser bundle (hand-built lazy-CJS plugin).
// The web shell's ClientModuleLoader executes this file as a classic script:
// window.__ModuleLoader__.load({ id, factory }) only REGISTERS the factory;
// materialization runs factory(require) and memoizes the exports. The module
// table resolves bare specifiers (react, @deepseek-ai/*) to other registered
// client bundles or the shell's static registry.
//
// The client half renders a small session-header toggle that reads and
// switches the auto-approve mode through the host's /auto-approve command via
// the standard wire contract: ctx.remote.commands.execute(sessionId, line).
window.__ModuleLoader__.load({
  id: "dsh-auto-approve",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let React = require("react");

    const inject = ["slots", "remote", "remote.commands", "sessions"];

    function apply(ctx) {
      const sessions = ctx.get("sessions");

      /** Run one machine command against the current session; returns parsed JSON. */
      const run = async (line) => {
        const sessionId = sessions.list.getSnapshot().current;
        if (sessionId === void 0) return { ok: false, error: "no active session" };
        let result;
        try {
          result = await ctx.remote.commands.execute(sessionId, line);
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

      function AutoApproveButton() {
        const [mode, setMode] = React.useState("sandbox");
        React.useEffect(() => {
          let alive = true;
          run("/auto-approve status").then((r) => {
            if (alive && r.ok && r.data && typeof r.data.mode === "string") setMode(r.data.mode);
          }).catch(() => {});
          return () => { alive = false; };
        }, []);
        const cycle = () => {
          const next = mode === "off" ? "sandbox" : mode === "sandbox" ? "all" : "off";
          run(`/auto-approve ${next}`).then((r) => {
            if (r.ok && r.data && typeof r.data.mode === "string") setMode(r.data.mode);
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
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
