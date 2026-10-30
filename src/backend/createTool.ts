import type { AgentToolResult, ExtensionContext, Theme, ToolAnnotations } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { withConciseValidationErrors } from "./toolValidation.ts";

/** The static part of a tool: name, label, description, schema — as exported by `tool_definitions/`. */
interface ToolDefinition {
  name: string;
  parameters: TSchema;
  [key: string]: unknown;
}

interface ToolHooks<TParams = Record<string, any>> {
  /** Renders the one-line call preview shown in the UI. */
  renderCall?: (args: TParams, theme: Theme) => { render(): string[]; invalidate(): void };
  /** Runs the tool. `params` are the validated arguments; `ctx` carries the abort signal and cwd. */
  execute: (params: TParams, ctx: { signal?: AbortSignal; cwd: string }) => Promise<AgentToolResult> | AgentToolResult;
  /** Extra tool-level annotations (e.g. readOnlyHint) some definitions carry. */
  annotations?: ToolAnnotations;
}

/**
 * Builds the full object handed to `pi.registerTool()` from a tool definition plus its hooks,
 * applying the cross-cutting parts every tool shares: concise validation errors via
 * `prepareArguments`, and an `execute` adapter that unpacks Pi's
 * `(toolCallId, params, signal, onUpdate, ctx)` signature into `(params, { signal, cwd })`.
 */
export function createTool<TDef extends ToolDefinition, TParams = Record<string, any>>(
  definition: TDef,
  hooks: ToolHooks<TParams>
) {
  return {
    ...definition,
    annotations: hooks.annotations,
    prepareArguments: withConciseValidationErrors(definition.name, definition.parameters),
    renderCall: hooks.renderCall,
    async execute(
      _toolCallId: string,
      params: TParams,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext
    ): Promise<AgentToolResult> {
      return hooks.execute(params, { signal, cwd: ctx.cwd });
    },
  };
}
