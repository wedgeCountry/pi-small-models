import {getAgentDir, type ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {registerCopyTool} from "./src/tools/copy.ts";
import {registerEditTool} from "./src/tools/edit.ts";
import {registerFindTool} from "./src/tools/find.ts";
import {registerFindUsagesTool} from "./src/tools/find_usages.ts";
import {registerGrepTool} from "./src/tools/grep.ts";
import {registerGitDiffTool} from "./src/tools/git_diff.ts";
import {registerGitLogTool} from "./src/tools/git_log.ts";
import {registerGitStatusTool} from "./src/tools/git_status.ts";
import {registerInsertTool} from "./src/tools/insert.ts";
import {registerListTool} from "./src/tools/list.ts";
import {registerLstatTool} from "./src/tools/lstat.ts";
import {registerMkdirTool} from "./src/tools/mkdir.ts";
import {registerMoveTool} from "./src/tools/move.ts";
import {registerReadTool} from "./src/tools/read.ts";
import {registerRemoveTool} from "./src/tools/remove.ts";
import {registerPiDocsTool} from "./src/tools/pi_docs.ts";
import {registerPiSkillsTool} from "./src/tools/pi_skills.ts";
import {registerWriteTool} from "./src/tools/write.ts";
import {INJECTION_GUARD_RULES} from "./src/injectionGuard.ts";
import {resetSkillsCache} from "./src/sandbox/piRoots.ts";
import {getSandboxState, setSandboxState, type SandboxState} from "./src/sandbox/sandbox.ts";
import {createGatedRegistry, createPermissionGate} from "./src/sandbox/permissionGate.ts";
import {
  appendGlobalIgnorePattern,
  getGlobalIgnorePath,
  getLocalIgnorePath,
  readIgnoreFile,
} from "./src/commands/ignore.ts";

const SANDBOX_STATES = new Set<SandboxState>(["on", "off"]);

// find/grep/edit/read/write override Pi's built-in tools of the same name (same-name registration
// replaces the built-in per Pi's tool registry).
const DISABLED_TOOLS = new Set(["bash"]);

export default function (pi: ExtensionAPI) {
  // Every tool registered through `tools` is gated: with the sandbox off, it asks before running.
  const {registry: tools, gatedTools} = createGatedRegistry(pi);
  registerCopyTool(tools);
  registerEditTool(tools);
  registerFindTool(tools);
  registerFindUsagesTool(tools);
  registerGrepTool(tools);
  registerGitDiffTool(tools);
  registerGitLogTool(tools);
  registerGitStatusTool(tools);
  registerInsertTool(tools);
  registerListTool(tools);
  registerLstatTool(tools);
  registerMkdirTool(tools);
  registerMoveTool(tools);
  // registerPeekTool(tools); // contained in read
  registerReadTool(tools);
  registerRemoveTool(tools);
  // registerSearchTool(tools); // deactivated, ambiguous to grep and find
  registerWriteTool(tools);

  // Pi's own documentation and the skills Pi discovered live outside the project root — and, for the
  // docs, inside a `node_modules` directory — so these two read-only tools are not project-sandbox
  // tools at all: they get a fixed root discovered from Pi's layout plus an always-enforced Sandbox over
  // just that root (src/sandbox/piRoots.ts), and are registered on `pi` directly rather than through the
  // gated registry, so `/toggle-sandbox off` doesn't ask for confirmation on every docs or skill lookup.
  registerPiDocsTool(pi);
  registerPiSkillsTool(pi);

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

  // One prompt-injection guard for the whole system prompt, not per tool: tool results and file
  // contents are data, never instructions. Registered once here instead of duplicated into every
  // tool's promptGuidelines.
  pi.on("before_agent_start", (event) => {
    for (const rule of INJECTION_GUARD_RULES) {
      if (!event.systemPromptOptions.promptGuidelines.includes(rule)) {
        event.systemPromptOptions.promptGuidelines.push(rule);
      }
    }
  });

  pi.on("session_start", (_event) => {
    pi.setActiveTools(pi.getActiveTools().filter((name) => !DISABLED_TOOLS.has(name)));
    // The sandbox state lives for the whole process, not one session; reset it so a previous
    // session's `/toggle-sandbox off` never leaks into a new one.
    setSandboxState("on");
    // Same for the discovered pi skills: a new session may sit in another directory, project trust may
    // have been granted or `/reload` may have installed packages since the last lookup.
    resetSkillsCache();
  });

  pi.on("tool_call", createPermissionGate(gatedTools));
}
