import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PY_LIST_TOOL_DEFINITION } from "../tool_definitions/py_list.ts";
import { oneLine, callName } from "../renderCall.ts";
import { withConciseValidationErrors } from "../toolValidation.ts";
import { pyListPackages, type PyHelperOptions, type PyListResult } from "./libInfo/pythonLib.ts";

export interface PyListOptions extends PyHelperOptions {
  package?: string;
}

/** Plain entry point (no ExtensionAPI): list installed Python distributions for the project's interpreter. */
export async function pyList(root: string, opts: PyListOptions = {}): Promise<PyListResult> {
  return pyListPackages(root, opts.package, opts);
}

export function registerPyListTool(pi: ExtensionAPI) {
  pi.registerTool({
    ...PY_LIST_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(PY_LIST_TOOL_DEFINITION.name, PY_LIST_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = callName(theme, "py_list");
      if (args.package) text += theme.fg("accent", ` ${args.package}`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await pyList(ctx.cwd, { package: params.package, signal });
      return {
        content: [{ type: "text", text: result.text }],
        details: { total: result.total, truncated: result.truncated },
      };
    },
  });
}
