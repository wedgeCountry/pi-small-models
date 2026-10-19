import type { ExtensionAPI, ExtensionContext, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { getSandboxState } from "./sandbox.ts";

/**
 * What replaces the sandbox while it is off: every call to one of this extension's tools needs an
 * explicit `ctx.ui.confirm()` approval before it runs. One-shot: neither a yes nor a no is
 * remembered. With no UI to ask (e.g. print mode), the call is blocked. While the sandbox is on,
 * the gate does nothing, since `sandbox.ts` enforces everything locally.
 *
 * The gated tools are exactly the ones registered through `createGatedRegistry`, so a new tool is
 * covered without anyone keeping a list. Tools from Pi or other extensions are left alone.
 */

/** The one part of Pi's API a tool's `register*Tool` function needs. */
export type ToolRegistry = Pick<ExtensionAPI, "registerTool">;

/** Wraps `pi` so every tool registered through it is also recorded as gated. */
export function createGatedRegistry(pi: ToolRegistry): {
  registry: ToolRegistry;
  gatedTools: ReadonlySet<string>;
} {
  const gatedTools = new Set<string>();
  
  const registry: ToolRegistry = {
    registerTool(tool) {
      gatedTools.add(tool.name);
      pi.registerTool(tool);
    },
  };
  
  return { registry, gatedTools };
}

/** The `pi.on("tool_call", …)` handler. Returning `{ block, reason }` stops the call; the model sees `reason`. */
export function createPermissionGate(gatedTools: ReadonlySet<string>) {
  return async (event: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | void> => {
    // If sandbox is on, sandbox.ts handles everything
    if (getSandboxState() === "on") return;
    
    // Only gate tools from this extension
    if (!gatedTools.has(event.toolName)) return;

    // No UI available: block the call
    if (!ctx.hasUI) {
      return {
        block: true,
        reason: "Sandbox is off and no interactive UI is available to confirm this call. " +
                "Run /toggle-sandbox on, or use an interactive session.",
      };
    }

    // Ask user for confirmation
    const approved = await ctx.ui.confirm(
      "Allow tool call?",
      describeToolCall(event.toolName, event.input as Record<string, unknown>)
    );
    
    if (!approved) {
      return { 
        block: true, 
        reason: `Denied by user (sandbox is off): ${event.toolName}` 
      };
    }
  };
}

/**
 * Safely get a string value from input, returning undefined if not a string.
 */
function getStringInput(input: Record<string, unknown>, key: string): string | undefined {
  return typeof input[key] === "string" ? input[key] as string : undefined;
}

/**
 * Builds the confirm dialog's message for a gated tool call. Every field is type-checked before
 * use, so malformed input can never break the prompt. Unknown tools show just their name.
 */
export function describeToolCall(toolName: string, input: Record<string, unknown>): string {
  const path = getStringInput(input, "path") ?? "?";
  const recursive = input.recursive === true ? " (recursive)" : "";

  switch (toolName) {
    // Simple path-based tools
    case "read":
    case "edit":
    case "mkdir":
    case "lstat":
      return `${toolName} ${path}`;

    // Write with content preview
    case "write": {
      const content = getStringInput(input, "content") ?? "";
      const preview = content.length > 50 ? content.slice(0, 50) + "..." : content;
      return content ? `${toolName} ${path} (${preview})` : `${toolName} ${path}`;
    }

    // Peek
    case "peek":
      return `peek ${path}`;

    // Remove with recursive flag
    case "remove":
      return `remove ${path}${recursive}`;

    // Copy and move with destination
    case "copy":
    case "move": {
      const destination = getStringInput(input, "destination") ?? "?";
      return `${toolName} ${path} -> ${destination}${recursive}`;
    }

    // List with path and recursive
    case "list":
      return `list ${getStringInput(input, "path") ?? "."}${recursive}`;

    // Insert with line number
    case "insert": {
      const line = typeof input.line === "number" ? ` after line ${input.line}` : "";
      return `insert into ${path}${line}`;
    }

    // Find and grep with pattern
    case "find":
    case "grep": {
      const pattern = getStringInput(input, "pattern") ?? "?";
      const scope = getStringInput(input, "path");
      return `${toolName} "${pattern}"${scope ? ` in ${scope}` : ""}`;
    }

    // Find usages
    case "find_usages": {
      const symbol = getStringInput(input, "symbol") ?? "?";
      const language = getStringInput(input, "language") ?? "?";
      const scope = getStringInput(input, "path");
      return `find_usages "${symbol}" (${language})${scope ? ` in ${scope}` : ""}`;
    }

    // Git tools with optional scope
    case "git_status":
    case "git_diff": {
      const scope = getStringInput(input, "path");
      return scope ? `${toolName} (${scope})` : toolName;
    }

    case "git_log": {
      const scope = getStringInput(input, "path");
      return scope ? `git_log (${scope})` : "git_log";
    }

    // Unknown tool: just show the name
    default:
      return toolName;
  }
}
