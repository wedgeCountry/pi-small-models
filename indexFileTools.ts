// src/indexFileTools.ts
import { ExtensionAPI } from "@pi-host/pi-extensions";
import { readTool } from "./tools/read";
import { writeTool } from "./tools/write";
import { listTool } from "./tools/list";
import { findTool } from "./tools/find";
import { grepTool } from "./tools/grep";
import { peekTool } from "./tools/peek";
import { mkdirTool } from "./tools/mkdir";
import { removeTool } from "./tools/remove";
import { copyTool } from "./tools/copy";
import { moveTool } from "./tools/move";
import { lstatTool } from "./tools/lstat";
import { editTool } from "./tools/edit";
import { insertTool } from "./tools/insert";
import { createGatedRegistry } from "./sandbox/permissionGate";

/**
 * Registers all file access tools with the Pi extension API.
 * @param pi The Pi extension API instance.
 */
export function registerFileTools(pi: ExtensionAPI) {
  const gatedRegister = createGatedRegistry(pi);

  // Register file access tools
  gatedRegister(readTool);
  gatedRegister(writeTool);
  gatedRegister(listTool);
  gatedRegister(findTool);
  gatedRegister(grepTool);
  gatedRegister(peekTool);
  gatedRegister(mkdirTool);
  gatedRegister(removeTool);
  gatedRegister(copyTool);
  gatedRegister(moveTool);
  gatedRegister(lstatTool);
  gatedRegister(editTool);
  gatedRegister(insertTool);
}