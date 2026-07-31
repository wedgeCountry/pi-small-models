import type {ExtensionAPI} from "@earendil-works/pi-coding-agent";
import {registerFindTool} from "./src/find.ts";
import {registerGrepTool} from "./src/grep.ts";
import {registerListTool} from "./src/list.ts";

// find/grep override Pi's built-in tools of the same name (same-name registration
// replaces the built-in per Pi's tool registry). "ls" has no name collision with
// "list", so it's dropped explicitly below to avoid offering two listing tools.
const DISABLED_TOOLS = new Set(["bash", "ls"]);

export default function (pi: ExtensionAPI) {
  registerFindTool(pi);
  registerGrepTool(pi);
  registerListTool(pi);

  pi.on("session_start", () => {
    pi.setActiveTools(pi.getActiveTools().filter((name) => !DISABLED_TOOLS.has(name)));
  });
}
