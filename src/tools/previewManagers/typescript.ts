import { previewBraceLanguage, type BraceDecl, type BraceLanguage } from "./braceEngine.ts";
import type { PeekLine, PeekVisibility, PreviewManager, PreviewOptions } from "./types.ts";

/**
 * The regexes that decide what the TypeScript/JavaScript PreviewManager shows.
 *
 * Top level (and inside `namespace`/`declare module`): classes, functions, interfaces, type
 * aliases, enums, namespaces and variables (`const f = () => …` shows the arrow signature; other
 * initializers are cut to `= …`). Function bodies become `{ … }`. Interface, enum and object-type
 * bodies are shown verbatim. Class bodies show methods, constructors, accessors and properties.
 *
 * Visibility: at top level, `export`ed (or `declare`d) declarations are public and everything else
 * is private (module-local). Class members are public unless marked `protected` (protected) or
 * `private` / `#name` (private).
 */
export const TYPESCRIPT_RULES = {
  /** Leading decorators on the same line as a member, e.g. `@Input() name: string;`. */
  leadingDecorators: /^(?:@[\w$.]+(?:\((?:[^()]|\([^()]*\))*\))?\s+)+/,
  /** A statement that is only a decorator (complete, or with an argument list left open). */
  attributeOnly: /^@[\w$.]+\s*(?:\((?:[^()]|\([^()]*\))*\)\s*)?$|^@[\w$.]+\s*\([^)]*$/,
  docComment: /^\s*\/\*\*/,

  exported: /^(?:export|declare)\b/,
  class: /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\b/,
  interface: /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?interface\b/,
  enum: /^(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\b/,
  typeAlias: /^(?:export\s+)?(?:declare\s+)?type\s+[\w$]+/,
  namespace: /^(?:export\s+)?(?:declare\s+)?(?:namespace|module)\b/,
  function: /^(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\b/,
  variable: /^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+/,
  /** `export default <expression>` and re-exports (`export { a } from`, `export * from`). */
  otherExport: /^export\s+(?:default\b|\*|\{)/,

  /** Class member modifiers. */
  memberModifiers: /^(?:(?:public|private|protected|static|abstract|override|readonly|async|declare|accessor)\s+)*/,
  privateMember: /^(?:[\w$]+\s+)*?(?:private\s|#)/,
  protectedMember: /^(?:[\w$]+\s+)*?protected\s/,
  /** Method, constructor, getter/setter or generator: a name followed by `(` or `<…>(`. */
  method: /^(?:(?:get|set)\s+)?\*?\s*(?:#?[\w$]+|\[[^\]]+\])\s*\??\s*(?:<[^>]*>)?\s*\(/,
  /** Property or index signature. */
  property: /^(?:#?[\w$]+|\[[^\]]+\])\s*[?!]?\s*(?:[:=;]|$)/,
  staticBlock: /^static\s*\{/,
} as const;

function classifyTopLevel(text: string): BraceDecl | null {
  const R = TYPESCRIPT_RULES;
  const visibility: PeekVisibility = R.exported.test(text) ? "public" : "private";
  if (R.class.test(text)) return { visibility, body: "members", childContainer: "class" };
  if (R.interface.test(text) || R.enum.test(text)) return { visibility, body: "verbatim" };
  if (R.typeAlias.test(text)) return { visibility, body: "verbatim" };
  if (R.namespace.test(text)) return { visibility, body: "members", childContainer: "namespace" };
  if (R.function.test(text)) return { visibility, body: "hidden" };
  if (R.variable.test(text)) return { visibility, body: "hidden", cutAt: ["assign", "arrow"] };
  if (R.otherExport.test(text)) return { visibility: "public", body: "verbatim" };
  return null;
}

function classifyClassMember(text: string): BraceDecl | null {
  const R = TYPESCRIPT_RULES;
  const stripped = text.replace(R.leadingDecorators, "");
  if (R.staticBlock.test(stripped)) return null;
  const visibility: PeekVisibility = R.privateMember.test(stripped)
    ? "private"
    : R.protectedMember.test(stripped)
      ? "protected"
      : "public";
  const rest = stripped.replace(R.memberModifiers, "");
  if (R.method.test(rest)) return { visibility, body: "hidden" };
  if (R.property.test(rest)) return { visibility, body: "hidden", cutAt: ["assign", "arrow"] };
  return null;
}

export const TYPESCRIPT_LANGUAGE: BraceLanguage = {
  docComment: TYPESCRIPT_RULES.docComment,
  attributeOnly: TYPESCRIPT_RULES.attributeOnly,
  asi: true,
  tsLexing: true,
  csLexing: false,
  classify(text, container) {
    return container === "class" ? classifyClassMember(text) : classifyTopLevel(text);
  },
};

export class TypeScriptPreviewManager implements PreviewManager {
  readonly language = "typescript";
  readonly extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;

  preview(lines: readonly string[], opts: PreviewOptions): PeekLine[] {
    return previewBraceLanguage(TYPESCRIPT_LANGUAGE, lines, opts);
  }
}
