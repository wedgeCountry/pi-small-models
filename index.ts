import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {registerEditTool} from "./src/tools/edit.ts";
import {registerFindTool} from "./src/tools/find.ts";
import {registerGrepTool} from "./src/tools/grep.ts";
import {registerListTool} from "./src/tools/list.ts";
import {registerLstatTool} from "./src/tools/lstat.ts";
import {registerMkdirTool} from "./src/tools/mkdir.ts";
import {registerRemoveTool} from "./src/tools/remove.ts";

// find/grep/edit override Pi's built-in tools of the same name (same-name registration
// replaces the built-in per Pi's tool registry).
const DISABLED_TOOLS = new Set(["bash"]);

export default function (pi: ExtensionAPI) {
  registerEditTool(pi);
  registerFindTool(pi);
  registerGrepTool(pi);
  registerListTool(pi);
  registerLstatTool(pi);
  registerMkdirTool(pi);
  registerRemoveTool(pi);

  pi.on("session_start", () => {
    pi.setActiveTools(pi.getActiveTools().filter((name) => !DISABLED_TOOLS.has(name)));
  });
}
