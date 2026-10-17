import type { ToolRegistry } from "../../src/sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../../src/sandbox/sandbox.ts";
import { PY_LIST_TOOL_DEFINITION } from "../tool_definitions/py_list.ts";
import { oneLine, callName } from "../../src/backend/renderCall.ts";
import { withConciseValidationErrors } from "../../src/backend/toolValidation.ts";
import { pyListPackages, type PyHelperOptions, type PyListResult } from "../../src/tools/libInfo/pythonLib.ts";

export interface PyListOptions extends PyHelperOptions {
  package?: string;
}

/** Plain entry point (no ExtensionAPI): list installed Python distributions for the project's interpreter. */
export async function pyList(sb: Sandbox, opts: PyListOptions = {}): Promise<PyListResult> {
  return pyListPackages(sb, opts.package, opts);
}

export function registerPyListTool(pi: ToolRegistry) {
  pi.registerTool({
    ...PY_LIST_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(PY_LIST_TOOL_DEFINITION.name, PY_LIST_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = callName(theme, "py_list");
      if (args.package) text += theme.fg("accent", ` ${args.package}`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await pyList(sandboxFor(ctx.cwd), { package: params.package, signal });
      return {
        content: [{ type: "text", text: result.text }],
        details: { total: result.total, truncated: result.truncated },
      };
    },
  });
}
