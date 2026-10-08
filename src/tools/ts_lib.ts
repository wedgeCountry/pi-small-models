import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { TS_LIB_TOOL_DEFINITION } from "../tool_definitions/ts_lib.ts";
import { oneLine, callName } from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";
import { extractTsLibrary } from "./libInfo/typescriptLib.ts";
import { renderLibrary, type LibRenderResult } from "./libInfo/format.ts";
import type { LibQueryOptions } from "./libInfo/types.ts";

export interface TsLibOptions extends LibQueryOptions {
  module?: string;
  signal?: AbortSignal;
}

/**
 * Plain entry point (no ExtensionAPI): locate `pkg` from the project root, extract its API with
 * the TypeScript compiler and render the overview / search / symbol view as text.
 */
export async function tsLib(sb: Sandbox, pkg: string, opts: TsLibOptions = {}): Promise<LibRenderResult> {
  const ex = await extractTsLibrary(sb, pkg, { module: opts.module, signal: opts.signal });
  return renderLibrary(ex, opts);
}

export function registerTsLibTool(pi: ToolRegistry) {
  pi.registerTool({
    ...TS_LIB_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(TS_LIB_TOOL_DEFINITION.name, TS_LIB_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = `${callName(theme, "ts_lib")} ${theme.fg("accent", args.package ?? "")}`;
      if (args.module) text += theme.fg("toolOutput", ` (${args.module})`);
      if (args.symbol) text += theme.fg("toolOutput", ` symbol ${args.symbol}`);
      if (args.query) text += theme.fg("toolOutput", ` query "${args.query}"`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await tsLib(sandboxFor(ctx.cwd), params.package, { ...params, signal });
      return {
        content: [{ type: "text", text: result.text }],
        details: { view: result.view, truncated: result.truncated },
      };
    },
  });
}
