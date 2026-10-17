import {getAgentDir, type ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {registerDotnetBuildTool} from "./coding/tools/dotnet_build.ts";
import {registerDotnetLibTool} from "./coding/tools/dotnet_lib.ts";
import {registerDotnetListTool} from "./coding/tools/dotnet_list.ts";
import {registerFindUsagesTool} from "./src/tools/find_usages.ts";
import {registerGitDiffTool} from "./src/tools/git_diff.ts";
import {registerGitLogTool} from "./src/tools/git_log.ts";
import {registerGitStatusTool} from "./src/tools/git_status.ts";
import {registerNpmListTool} from "./coding/tools/npm_list.ts";
import {registerPyLibTool} from "./coding/tools/py_lib.ts";
import {registerPyListTool} from "./coding/tools/py_list.ts";
import {registerTsCheckTool} from "./coding/tools/ts_check.ts";
import {registerTsLibTool} from "./coding/tools/ts_lib.ts";
import {createGatedRegistry, createPermissionGate} from "./src/sandbox/permissionGate.ts";

// find/grep/edit/read/write override Pi's built-in tools of the same name (same-name registration
// replaces the built-in per Pi's tool registry).
const DISABLED_TOOLS = new Set(["bash"]);

export default function (pi: ExtensionAPI) {
  // Every tool registered through `tools` is gated: with the sandbox off, it asks before running.
  const {registry: tools, gatedTools} = createGatedRegistry(pi);
  //registerDotnetBuildTool(tools);
  //registerDotnetLibTool(tools);
  //registerDotnetListTool(tools);
  registerFindUsagesTool(tools);
  registerGitDiffTool(tools);
  registerGitLogTool(tools);
  registerGitStatusTool(tools);
  //registerNpmListTool(tools);
  //registerPyLibTool(tools);
  //registerPyListTool(tools);
  //registerTsCheckTool(tools);
  //registerTsLibTool(tools);

  pi.on("before_agent_start", (event) => {
    const opts = event.systemPromptOptions;
    opts.appendSystemPrompt = "You do not have tools to build or execute code, run tests or check syntax. Solve all problems using the tools you have available. To build, execute or test code tell the user to do so in the summary. ";
  });

  pi.on("session_start", (_event) => {
    pi.setActiveTools(pi.getActiveTools().filter((name) => !DISABLED_TOOLS.has(name)));
  });

  pi.on("tool_call", createPermissionGate(gatedTools));

}
