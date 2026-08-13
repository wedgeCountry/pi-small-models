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

  pi.on("session_start", () => {
    pi.setActiveTools(pi.getActiveTools().filter((name) => !DISABLED_TOOLS.has(name)));
  });
}
