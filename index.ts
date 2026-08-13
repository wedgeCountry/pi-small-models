import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {registerEditTool} from "./src/tools/edit.ts";
import {registerFindTool} from "./src/tools/find.ts";
import {registerGitDiffTool} from "./src/tools/git_diff.ts";
import {registerGitStatusTool} from "./src/tools/git_status.ts";
import {registerGrepTool} from "./src/tools/grep.ts";
import {registerInsertTool} from "./src/tools/insert.ts";
import {registerListTool} from "./src/tools/list.ts";
import {registerLstatTool} from "./src/tools/lstat.ts";
import {registerMkdirTool} from "./src/tools/mkdir.ts";
import {registerReadTool} from "./src/tools/read.ts";
import {registerRemoveTool} from "./src/tools/remove.ts";
import {registerWriteTool} from "./src/tools/write.ts";
import {cycleSandboxState, setSandboxState, type SandboxState} from "./src/sandbox.ts";
import {gateToolCall} from "./src/permissionGate.ts";

const SANDBOX_STATES = new Set<SandboxState>(["on", "off"]);

// find/grep/edit/read/write override Pi's built-in tools of the same name (same-name registration
// replaces the built-in per Pi's tool registry).
const DISABLED_TOOLS = new Set(["bash"]);

export default function (pi: ExtensionAPI) {
  registerEditTool(pi);
  registerFindTool(pi);
  registerGitDiffTool(pi);
  registerGitStatusTool(pi);
  registerGrepTool(pi);
  registerInsertTool(pi);
  registerListTool(pi);
  registerLstatTool(pi);
  registerMkdirTool(pi);
  registerReadTool(pi);
  registerRemoveTool(pi);
  registerWriteTool(pi);

  pi.registerCommand("toggle-sandbox", {
    description: "Set src/sandbox.ts's state: on (fully enforced locally — root containment plus " +
      "credential/.git glob restrictions, no confirmation prompts) or off (nothing enforced locally; " +
      "every call to one of this project's tools requires an explicit approval dialog instead, see " +
      "src/permissionGate.ts). No argument toggles on <-> off.",
    getArgumentCompletions: (prefix) =>
      [...SANDBOX_STATES].filter((s) => s.startsWith(prefix)).map((value) => ({value, label: value})),
    handler: async (args, ctx) => {
      const requested = args.trim().toLowerCase();
      let state: SandboxState;
      if (requested === "") {
        state = cycleSandboxState();
      } else if (SANDBOX_STATES.has(requested as SandboxState)) {
        state = requested as SandboxState;
        setSandboxState(state);
      } else {
        ctx.ui.notify(`Unknown sandbox state "${requested}" — expected on or off`, "error");
        return;
      }

      ctx.ui.notify(`Sandbox: ${state}`, state === "on" ? "info" : "warning");
    },
  });

  pi.on("session_start", (_event) => {
    pi.setActiveTools(pi.getActiveTools().filter((name) => !DISABLED_TOOLS.has(name)));
    // sandboxState (src/sandbox.ts) is a module-level, process-lifetime variable, not a
    // per-session one — if the extension module is ever shared across concurrent sessions in one
    // process, a previous session's `/toggle-sandbox off` would otherwise leak into a new session
    // that never asked for it. Reset it explicitly so every session starts fully enforced
    // regardless of what any other session left it at.
    setSandboxState("on");
  });

  // See src/permissionGate.ts: while sandbox state is "off", intercepts calls to this
  // project's own tools and requires an explicit ctx.ui.confirm() approval before each one runs.
  pi.on("tool_call", gateToolCall);
}
