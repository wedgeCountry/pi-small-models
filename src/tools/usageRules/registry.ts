import type { UsageKind } from "./types.ts";
import { classifyPythonLine, detectPythonKind, type PythonKnownKind } from "./python.ts";
import { classifyTypeScriptLine } from "./typescript.ts";
import { classifyCSharpLine } from "./csharp.ts";

export type FindUsagesLanguage = "python" | "typescript" | "csharp";

export const FIND_USAGES_LANGUAGES: readonly FindUsagesLanguage[] = ["python", "typescript", "csharp"];

/**
 * Every language rule is called through this same three-argument shape, even though only Python's
 * classifier actually consults `knownKind` (the bare-call ambiguity python.ts's docstring explains —
 * TypeScript/C# have no such ambiguity, since `new` already marks instantiation unambiguously, so
 * their wrappers below just ignore the third argument). Keeping one shape lets the orchestration
 * layer in find_usages.ts stay language-agnostic instead of branching per language.
 */
export interface LanguageRule {
  /** fast-glob pattern selecting which files in the scan this language's classifier applies to. */
  readonly glob: string;
  classifyLine(line: string, symbol: string, knownKind: PythonKnownKind): UsageKind | null;
  /** Only Python needs this: a whole-scope pre-pass to resolve a bare call's kind ahead of time. */
  detectKind?(lines: readonly string[], symbol: string): PythonKnownKind;
}

export const LANGUAGE_RULES: Record<FindUsagesLanguage, LanguageRule> = {
  python: {
    glob: "**/*.py",
    classifyLine: classifyPythonLine,
    detectKind: detectPythonKind,
  },
  typescript: {
    // JS files are included under the "typescript" rule set because the syntax the classifier
    // cares about (imports, classes, `new`, member access, calls) is shared — a .js file simply
    // never produces a match for the TS-only type-annotation/generic patterns.
    glob: "**/*.{ts,tsx,js,jsx,mjs,cjs}",
    classifyLine: (line, symbol) => classifyTypeScriptLine(line, symbol),
  },
  csharp: {
    glob: "**/*.cs",
    classifyLine: (line, symbol) => classifyCSharpLine(line, symbol),
  },
};
