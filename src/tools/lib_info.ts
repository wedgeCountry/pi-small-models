import * as fs from "node:fs/promises";
import * as path from "node:path";
import { LIB_INFO_TOOL_DEFINITION } from "../tool_definitions/lib_info.ts";
import type { ToolRegistry } from "../sandbox/permissionGate.ts";
import { sandboxFor, type Sandbox } from "../sandbox/sandbox.ts";
import { oneLine, callName } from "../backend/renderCall.ts";
import { withConciseValidationErrors } from "../backend/toolValidation.ts";
import { extractTsLibrary } from "./libInfo/typescriptLib.ts";
import { extractPyLibrary, type PyHelperOptions } from "./libInfo/pythonLib.ts";
import { extractDotnetLibrary, type DotnetLibOptions } from "./libInfo/dotnetLib.ts";
import { renderLibrary, type LibRenderResult } from "./libInfo/format.ts";
import type { LibQueryOptions } from "./libInfo/types.ts";

export type LibInfoLanguage = "typescript" | "python" | "dotnet";

export interface LibInfoOptions extends LibQueryOptions, PyHelperOptions, DotnetLibOptions {
  /** Pin the language. Omit to auto-detect: typescript, then python, then dotnet. */
  language?: LibInfoLanguage;
  signal?: AbortSignal;
  /** Tests only: inject mock step implementations. */
  deps?: Partial<LibInfoDeps>;
}

/** The per-language extractors `libInfo` orchestrates (injectable for tests). */
export interface LibInfoDeps {
  extractTsLibrary: typeof extractTsLibrary;
  extractPyLibrary: typeof extractPyLibrary;
  extractDotnetLibrary: typeof extractDotnetLibrary;
}

export interface LibInfoResult extends LibRenderResult {
  language: LibInfoLanguage;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** True when the npm package `pkg` is installed (node_modules/<pkg> exists at or above root). */
async function tsPackageExists(root: string, pkg: string): Promise<boolean> {
  const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
  if (!NPM_NAME.test(pkg)) return false;
  let dir = root;
  while (true) {
    if (await pathExists(path.join(dir, "node_modules", pkg))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * Unified library lookup: shows the API of an installed package in whichever
 * language it exists. With `language` omitted, tries TypeScript (npm), then
 * Python, then .NET; the first extractor that finds the package wins. Package
 * lookup failures are step errors, only a missing interpreter/toolchain ends
 * the search for that language.
 */
export async function libInfo(sb: Sandbox, pkg: string, opts: LibInfoOptions = {}): Promise<LibInfoResult> {
  opts.signal?.throwIfAborted();

  const wanted: LibInfoLanguage[] = opts.language
    ? [opts.language]
    : ["typescript", "python", "dotnet"];
  const deps: LibInfoDeps = { extractTsLibrary, extractPyLibrary, extractDotnetLibrary, ...opts.deps };
  const errors: string[] = [];

  for (const language of wanted) {
    opts.signal?.throwIfAborted();
    if (language === "typescript") {
      if (!(await tsPackageExists(sb.root, pkg))) {
        errors.push(`typescript: package "${pkg}" is not installed in node_modules`);
        continue;
      }
      const ex = await deps.extractTsLibrary(sb, pkg, { module: opts.module, signal: opts.signal });
      return { language, ...(await renderLibrary(ex, opts)) };
    }
    if (language === "python") {
      let ex;
      try {
        ex = await deps.extractPyLibrary(sb, pkg, opts);
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        errors.push(`python: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      return { language, ...(await renderLibrary(ex, { ...opts, symbol: opts.symbol ? ex.symbol ?? opts.symbol : undefined })) };
    }
    // dotnet
    let ex;
    try {
      ex = await deps.extractDotnetLibrary(sb, pkg, opts);
    } catch (err) {
      if ((err as Error).name === "AbortError") throw err;
      errors.push(`dotnet: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    return { language, ...(await renderLibrary(ex, opts)) };
  }

  const hint = opts.language ? "" : " Use the matching *_list tool to see installed packages.";
  throw new Error(`Could not find package "${pkg}" in any language.\n${errors.map((e) => `  - ${e}`).join("\n")}${hint}`);
}

export function registerLibInfoTool(pi: ToolRegistry) {
  pi.registerTool({
    ...LIB_INFO_TOOL_DEFINITION,
    prepareArguments: withConciseValidationErrors(LIB_INFO_TOOL_DEFINITION.name, LIB_INFO_TOOL_DEFINITION.parameters),
    renderCall(args, theme) {
      let text = `${callName(theme, "lib_info")} ${theme.fg("accent", args.package ?? "")}`;
      if (args.language) text += theme.fg("toolOutput", ` [${args.language}]`);
      if (args.module) text += theme.fg("toolOutput", ` (${args.module})`);
      if (args.symbol) text += theme.fg("toolOutput", ` symbol ${args.symbol}`);
      if (args.query) text += theme.fg("toolOutput", ` query "${args.query}"`);
      return oneLine(text);
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await libInfo(sandboxFor(ctx.cwd), params.package, {
        ...params,
        language: params.language as LibInfoLanguage | undefined,
        signal,
      });
      const header = `Language: ${result.language}\n\n`;
      return {
        content: [{ type: "text", text: header + result.text }],
        details: { language: result.language, view: result.view, truncated: result.truncated },
      };
    },
  });
}
