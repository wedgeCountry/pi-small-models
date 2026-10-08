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
export function createGatedRegistry(pi: ToolRegistry): { registry: ToolRegistry; gatedTools: ReadonlySet<string> } {
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
    if (getSandboxState() === "on") return;
    if (!gatedTools.has(event.toolName)) return;

    if (!ctx.hasUI) {
      return {
        block: true,
        reason:
          "Sandbox is off and no interactive UI is available to confirm this call. Run /toggle-sandbox on, or use an interactive session.",
      };
    }

    const approved = await ctx.ui.confirm(
      "Allow tool call?",
      describeToolCall(event.toolName, event.input as Record<string, unknown>)
    );
    if (!approved) {
      return { block: true, reason: `Denied by user (sandbox is off): ${event.toolName}` };
    }
  };
}

function str(input: Record<string, unknown>, key: string): string | undefined {
  return typeof input[key] === "string" ? (input[key] as string) : undefined;
}

/**
 * Builds the confirm dialog's message for a gated tool call. Every field is type-checked before
 * use, so malformed input can never break the prompt. Unknown tools show just their name.
 */
export function describeToolCall(toolName: string, input: Record<string, unknown>): string {
  const path = str(input, "path") ?? "?";
  const recursive = input.recursive === true ? " (recursive)" : "";

  switch (toolName) {
    case "read":
    case "write":
    case "edit":
    case "mkdir":
    case "lstat":
      return `${toolName} ${path}`;
    case "peek":
      return `peek ${path}`;
    case "remove":
      return `remove ${path}${recursive}`;
    case "copy":
    case "move": {
      const destination = str(input, "destination") ?? "?";
      return `${toolName} ${path} -> ${destination}${recursive}`;
    }
    case "list":
      return `list ${str(input, "path") ?? "."}${recursive}`;
    case "insert": {
      const line = typeof input.line === "number" ? ` after line ${input.line}` : "";
      return `insert into ${path}${line}`;
    }
    case "find":
    case "grep": {
      const pattern = str(input, "pattern") ?? "?";
      const scope = str(input, "path");
      return `${toolName} "${pattern}"${scope ? ` in ${scope}` : ""}`;
    }
    case "find_usages": {
      const symbol = str(input, "symbol") ?? "?";
      const language = str(input, "language") ?? "?";
      const scope = str(input, "path");
      return `find_usages "${symbol}" (${language})${scope ? ` in ${scope}` : ""}`;
    }
    case "git_status":
    case "git_diff": {
      const scope = str(input, "path");
      return scope ? `${toolName} (${scope})` : toolName;
    }
    case "git_log": {
      const scope = str(input, "path");
      return scope ? `git_log (${scope})` : "git_log";
    }
    case "ts_lib":
    case "py_lib":
    case "dotnet_lib": {
      const pkg = str(input, "package") ?? "?";
      const module = str(input, "module");
      const symbol = str(input, "symbol");
      const query = str(input, "query");
      const detail = symbol ? ` symbol ${symbol}` : query ? ` search "${query}"` : "";
      return `${toolName} ${pkg}${module ? ` (${module})` : ""}${detail} — reads installed package files`;
    }
    case "py_list": {
      const pkg = str(input, "package");
      return `py_list${pkg ? ` ${pkg}` : ""} — runs the project's Python interpreter`;
    }
    default:
      return toolName;
  }
}
