// src/indexCodingTools.ts
import { ExtensionAPI } from "@pi-host/pi-extensions";
import { gitStatusTool } from "./tools/git_status";
import { gitDiffTool } from "./tools/git_diff";
import { gitLogTool } from "./tools/git_log";
import { tsLibTool } from "./tools/ts_lib";
import { pyLibTool } from "./tools/py_lib";
import { dotnetLibTool } from "./tools/dotnet_lib";
import { npmListTool } from "./tools/npm_list";
import { pyListTool } from "./tools/py_list";
import { tsCheckTool } from "./tools/ts_check";
import { findUsagesTool } from "./tools/find_usages";
import { createGatedRegistry } from "./sandbox/permissionGate";

/**
 * Registers all coding-related tools with the Pi extension API.
 * @param pi The Pi extension API instance.
 */
export function registerCodingTools(pi: ExtensionAPI) {
  const gatedRegister = createGatedRegistry(pi);

  // Register coding-related tools
  gatedRegister(gitStatusTool);
  gatedRegister(gitDiffTool);
  gatedRegister(gitLogTool);
  gatedRegister(tsLibTool);
  gatedRegister(pyLibTool);
  gatedRegister(dotnetLibTool);
  gatedRegister(npmListTool);
  gatedRegister(pyListTool);
  gatedRegister(tsCheckTool);
  gatedRegister(findUsagesTool);
}