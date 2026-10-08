import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { DOTNET_LIB_TOOL_DEFINITION } from "../tool_definitions/dotnet_lib.ts";
import { oneLine, callName } from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";
import { extractDotnetLibrary, type DotnetLibOptions } from "./libInfo/dotnetLib.ts";
import { renderLibrary, type LibRenderResult } from "./libInfo/format.ts";
import type { LibQueryOptions } from "./libInfo/types.ts";

export interface DotnetLibToolOptions extends LibQueryOptions, DotnetLibOptions {}

/**
 * Plain entry point (no ExtensionAPI): find `pkg` in the project's restored packages (or the
 * shared framework) and render its XML-documented API as text.
 */
export async function dotnetLib(sb: Sandbox, pkg: string, opts: DotnetLibToolOptions = {}): Promise<LibRenderResult> {
  const ex = await extractDotnetLibrary(sb, pkg, opts);
  return renderLibrary(ex, opts);
}

export function registerDotnetLibTool(pi: ToolRegistry) {
  pi.registerTool({
    ...DOTNET_LIB_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(DOTNET_LIB_TOOL_DEFINITION.name, DOTNET_LIB_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = `${callName(theme, "dotnet_lib")} ${theme.fg("accent", args.package ?? "")}`;
      if (args.module) text += theme.fg("toolOutput", ` (${args.module})`);
      if (args.symbol) text += theme.fg("toolOutput", ` symbol ${args.symbol}`);
      if (args.query) text += theme.fg("toolOutput", ` query "${args.query}"`);
      if (args.project) text += theme.fg("toolOutput", ` --project ${args.project}`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await dotnetLib(sandboxFor(ctx.cwd), params.package, { ...params, signal });
      return {
        content: [{ type: "text", text: result.text }],
        details: { view: result.view, truncated: result.truncated },
      };
    },
  });
}
