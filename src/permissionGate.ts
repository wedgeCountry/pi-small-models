import type { ExtensionContext, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";
import { getSandboxState } from "./sandbox.ts";

/**
 * This project's own `on`/`off` decision system, built directly on Pi's
 * `tool_call` event (`ExtensionAPI.on("tool_call", ...)`) and
 * `ctx.ui.confirm` — no other extension required.
 *
 * An earlier version of this file tried to cooperate with the separate
 * `@gotgenes/pi-permission-system` extension via a `registerAuthorizer`
 * hook, on the theory that `"on"` could auto-allow anything already covered
 * by this project's own sandbox and avoid asking twice. That hook doesn't
 * exist on the package's actual public API (confirmed by reading the
 * installed package's `docs/cross-extension-api.md`: `PermissionsService`
 * only exposes `checkPermission`/`getToolPermission` and two prompt-text
 * registration hooks, nothing that can inject an allow/deny/ask decision) —
 * so the integration silently never worked, in either sandbox state. This
 * file replaces it with something that actually does, at the cost of no
 * longer trying to avoid a second prompt from any separately installed
 * permission extension — that extension, if present, still applies its own
 * policy to every call independently of this one.
 *
 * - `"on"` — sandbox.ts's containment/restricted-glob checks are already
 *   full local enforcement; this gate stays out of the way entirely (no
 *   prompts, "yolo inside the project dir" per `/toggle-sandbox`'s intent).
 * - `"off"` — sandbox.ts enforces nothing, so every call to one of this
 *   project's own tools is intercepted here and requires an explicit
 *   `ctx.ui.confirm()` approval before it's allowed to run. One-shot only:
 *   declining a call doesn't remember the decision for next time, and
 *   approving one doesn't either.
 */

/** The tools this project registers — see index.ts. Anything else (built-ins
 * this project doesn't touch, other extensions' tools) is left alone. */
const GATED_TOOL_NAMES = new Set([
  "find",
  "grep",
  "edit",
  "read",
  "write",
  "list",
  "mkdir",
  "remove",
  "lstat",
  "insert",
  "git_status",
  "git_diff",
]);

function str(input: Record<string, unknown>, key: string): string | undefined {
  return typeof input[key] === "string" ? (input[key] as string) : undefined;
}

/**
 * Builds the confirm dialog's message body for a gated tool call. Pure and
 * defensive (every field is type-checked before use, per the same "must not
 * throw" discipline `@gotgenes/pi-permission-system`'s own formatter docs
 * call for) so a malformed or partial tool-call input can never break the
 * prompt. Falls back to the bare tool name for anything unrecognized.
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
    case "remove":
      return `remove ${path}${recursive}`;
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
    case "git_status":
    case "git_diff": {
      const scope = str(input, "path");
      return scope ? `${toolName} (${scope})` : toolName;
    }
    default:
      return toolName;
  }
}

/**
 * `ExtensionAPI.on("tool_call", ...)` handler — see index.ts for
 * registration. Fires before any tool executes; returning
 * `{ block: true, reason }` stops it, with `reason` surfaced back to the
 * model so it can report why to the user.
 */
export async function gateToolCall(event: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | void> {
  if (getSandboxState() !== "off") return; // "on": sandbox.ts already fully enforces, no gate needed
  if (!GATED_TOOL_NAMES.has(event.toolName)) return; // not one of this project's tools

  if (!ctx.hasUI) {
    // No one to ask — fail safe rather than silently letting an unsandboxed
    // call through just because there's no dialog available (e.g. print mode).
    return {
      block: true,
      reason: "Sandbox is off and no interactive UI is available to confirm this call. Run /toggle-sandbox on, or use an interactive session.",
    };
  }

  const approved = await ctx.ui.confirm(
    "Allow tool call?",
    describeToolCall(event.toolName, event.input as Record<string, unknown>)
  );
  if (!approved) {
    return { block: true, reason: `Denied by user (sandbox is off): ${event.toolName}` };
  }
}
