import {getAgentDir, type ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {registerCopyTool} from "./src/tools/copy.ts";
import {registerDotnetBuildTool} from "./src/tools/dotnet_build.ts";
import {registerDotnetLibTool} from "./src/tools/dotnet_lib.ts";
import {registerDotnetListTool} from "./src/tools/dotnet_list.ts";
import {registerEditTool} from "./src/tools/edit.ts";
import {registerFindTool} from "./src/tools/find.ts";
import {registerFindUsagesTool} from "./src/tools/find_usages.ts";
import {registerGitDiffTool} from "./src/tools/git_diff.ts";
import {registerGitLogTool} from "./src/tools/git_log.ts";
import {registerGitStatusTool} from "./src/tools/git_status.ts";
import {registerGrepTool} from "./src/tools/grep.ts";
import {registerInsertTool} from "./src/tools/insert.ts";
import {registerListTool} from "./src/tools/list.ts";
import {registerLstatTool} from "./src/tools/lstat.ts";
import {registerMkdirTool} from "./src/tools/mkdir.ts";
import {registerMoveTool} from "./src/tools/move.ts";
import {registerNpmListTool} from "./src/tools/npm_list.ts";
import {registerPeekTool} from "./src/tools/peek.ts";
import {registerPyLibTool} from "./src/tools/py_lib.ts";
import {registerPyListTool} from "./src/tools/py_list.ts";
import {registerReadTool} from "./src/tools/read.ts";
import {registerRemoveTool} from "./src/tools/remove.ts";
import {registerSearchTool} from "./src/tools/search.ts";
import {registerTsCheckTool} from "./src/tools/ts_check.ts";
import {registerTsLibTool} from "./src/tools/ts_lib.ts";
import {registerWriteTool} from "./src/tools/write.ts";
import {getSandboxState, setSandboxState, type SandboxState} from "./src/sandbox/sandbox.ts";
import {createGatedRegistry, createPermissionGate} from "./src/sandbox/permissionGate.ts";
import {
  appendGlobalIgnorePattern,
  getGlobalIgnorePath,
  getLocalIgnorePath,
  readIgnoreFile,
} from "./src/ignore.ts";

const SANDBOX_STATES = new Set<SandboxState>(["on", "off"]);

// find/grep/edit/read/write override Pi's built-in tools of the same name (same-name registration
// replaces the built-in per Pi's tool registry).
const DISABLED_TOOLS = new Set(["bash"]);

export default function (pi: ExtensionAPI) {
  // Every tool registered through `tools` is gated: with the sandbox off, it asks before running.
  const {registry: tools, gatedTools} = createGatedRegistry(pi);
  registerCopyTool(tools);
  registerDotnetBuildTool(tools);
  registerDotnetLibTool(tools);
  registerDotnetListTool(tools);
  registerEditTool(tools);
  registerFindTool(tools);
  registerFindUsagesTool(tools);
  registerGitDiffTool(tools);
  registerGitLogTool(tools);
  registerGitStatusTool(tools);
  registerGrepTool(tools);
  registerInsertTool(tools);
  registerListTool(tools);
  registerLstatTool(tools);
  registerMkdirTool(tools);
  registerMoveTool(tools);
  registerNpmListTool(tools);
  registerPeekTool(tools);
  registerPyLibTool(tools);
  registerPyListTool(tools);
  registerReadTool(tools);
  registerRemoveTool(tools);
  registerSearchTool(tools);
  registerTsCheckTool(tools);
  registerTsLibTool(tools);
  registerWriteTool(tools);

  pi.registerCommand("toggle-sandbox", {
    description: "Set the sandbox (src/sandbox/sandbox.ts): on (fully enforced locally — root containment plus " +
      "credential/.git glob restrictions, no confirmation prompts) or off (nothing enforced locally; " +
      "every call to one of this project's tools requires an explicit approval dialog instead, see " +
      "src/sandbox/permissionGate.ts). No argument toggles on <-> off.",
    getArgumentCompletions: (prefix) =>
      [...SANDBOX_STATES].filter((s) => s.startsWith(prefix)).map((value) => ({value, label: value})),
    handler: async (args, ctx) => {
      const requested = args.trim().toLowerCase();
      let state: SandboxState;
      if (requested === "") {
        state = getSandboxState() === "on" ? "off" : "on";
      } else if (SANDBOX_STATES.has(requested as SandboxState)) {
        state = requested as SandboxState;
      } else {
        ctx.ui.notify(`Unknown sandbox state "${requested}" — expected on or off`, "error");
        return;
      }

      setSandboxState(state);
      ctx.ui.notify(`Sandbox: ${state}`, state === "on" ? "info" : "warning");
    },
  });

  pi.registerCommand("ignore", {
    description:
      "No argument: show the patterns in the global and local ignore files, which find/grep/list apply on " +
      "top of their built-in defaults (see src/ignore.ts). With a glob-pattern argument: append it to the " +
      "global ignore file, shared across every project (edit the local .piignore file at the project root " +
      "directly for project-specific patterns instead).",
    handler: async (args, ctx) => {
      const pattern = args.trim();
      const agentDir = getAgentDir();
      const globalPath = getGlobalIgnorePath(agentDir);
      const localPath = getLocalIgnorePath(ctx.cwd);

      if (pattern === "") {
        const [globalPatterns, localPatterns] = await Promise.all([
          readIgnoreFile(globalPath),
          readIgnoreFile(localPath),
        ]);
        const renderSection = (label: string, filePath: string, patterns: string[]) =>
          `${label} (${filePath}):\n` + (patterns.length ? patterns.map((p) => `  ${p}`).join("\n") : "  (empty)");

        ctx.ui.notify(
          `${renderSection("Global ignore", globalPath, globalPatterns)}\n\n` +
            renderSection("Local ignore", localPath, localPatterns),
          "info"
        );
        return;
      }

      const {added} = await appendGlobalIgnorePattern(agentDir, pattern);
      ctx.ui.notify(
        added
          ? `Added "${pattern}" to the global ignore file (${globalPath}).`
          : `"${pattern}" is already in the global ignore file (${globalPath}).`,
        "info"
      );
    },
  });

  pi.on("session_start", (_event) => {
    pi.setActiveTools(pi.getActiveTools().filter((name) => !DISABLED_TOOLS.has(name)));
    // The sandbox state lives for the whole process, not one session; reset it so a previous
    // session's `/toggle-sandbox off` never leaks into a new one.
    setSandboxState("on");
  });

  pi.on("tool_call", createPermissionGate(gatedTools));
}
