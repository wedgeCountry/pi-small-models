import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { withConciseValidationErrors } from "./toolValidation.ts";

/** The static part of a tool: name, label, description, schema — as exported by `tool_definitions/`. */
export interface ToolDefinitionShape {
  name: string;
  parameters: TSchema;
  [key: string]: unknown;
}

/** What a tool's `execute` needs beyond its validated params. */
export interface ToolRunContext {
  signal?: AbortSignal;
  cwd: string;
}

export interface ToolRunResult {
  content: { type: "text"; text: string }[];
  details: unknown;
}

export interface ToolHooks<TParams> {
  /** Renders the one-line call preview shown in the UI. */
  renderCall?: (args: Record<string, any>, theme: Theme) => { render(): string[]; invalidate(): void };
  /** Runs the tool. `params` are the validated arguments; `ctx` carries the abort signal and cwd. */
  execute: (params: TParams, ctx: ToolRunContext) => Promise<ToolRunResult> | ToolRunResult;
  /** Extra tool-level annotations (e.g. readOnlyHint) some definitions carry. */
  annotations?: Record<string, unknown>;
}

/**
 * Builds the full object handed to `pi.registerTool()` from a tool definition plus its hooks,
 * applying the cross-cutting parts every tool shares: concise validation errors via
 * `prepareArguments`, and an `execute` adapter that unpacks Pi's
 * `(toolCallId, params, signal, onUpdate, ctx)` signature into `(params, { signal, cwd })`.
 */
export function defineTool<TDef extends ToolDefinitionShape, TParams = Record<string, any>>(
  definition: TDef,
  hooks: ToolHooks<TParams>
) {
  return {
    ...definition,
    ...(hooks.annotations ? { annotations: hooks.annotations } : {}),
    prepareArguments: withConciseValidationErrors(definition.name, definition.parameters),
    ...(hooks.renderCall ? { renderCall: hooks.renderCall } : {}),
    async execute(
      _toolCallId: string,
      params: TParams,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext
    ): Promise<ToolRunResult> {
      return hooks.execute(params, { signal, cwd: ctx.cwd });
    },
  };
}
