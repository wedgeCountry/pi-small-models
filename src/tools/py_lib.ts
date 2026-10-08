import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PY_LIB_TOOL_DEFINITION } from "../tool_definitions/py_lib.ts";
import { oneLine, callName } from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";
import { extractPyLibrary, type PyHelperOptions } from "./libInfo/pythonLib.ts";
import { renderLibrary, type LibRenderResult } from "./libInfo/format.ts";
import type { LibQueryOptions } from "./libInfo/types.ts";

export interface PyLibToolOptions extends LibQueryOptions, PyHelperOptions {
  module?: string;
  includePrivate?: boolean;
}

/**
 * Plain entry point (no ExtensionAPI): read `pkg`'s API with the project's Python interpreter
 * (see `findPythonInterpreter`) and render the overview / search / symbol view as text.
 */
export async function pyLib(root: string, pkg: string, opts: PyLibToolOptions = {}): Promise<LibRenderResult> {
  const ex = await extractPyLibrary(root, pkg, opts);
  return renderLibrary(ex, { ...opts, symbol: opts.symbol ? ex.symbol ?? opts.symbol : undefined });
}

export function registerPyLibTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...PY_LIB_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(PY_LIB_TOOL_DEFINITION.name, PY_LIB_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = `${callName(theme, "py_lib")} ${theme.fg("accent", args.package ?? "")}`;
      if (args.module) text += theme.fg("toolOutput", ` (${args.module})`);
      if (args.symbol) text += theme.fg("toolOutput", ` symbol ${args.symbol}`);
      if (args.query) text += theme.fg("toolOutput", ` query "${args.query}"`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await pyLib(ctx.cwd, params.package, { ...params, signal });
      return {
        content: [{ type: "text", text: result.text }],
        details: { view: result.view, truncated: result.truncated },
      };
    },
  });
}
