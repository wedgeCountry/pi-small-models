import { previewBraceLanguage, type BraceDecl, type BraceLanguage } from "./braceEngine.ts";
import type { PeekLine, PeekVisibility, PreviewManager, PreviewOptions } from "./types.ts";

/**
 * The regexes that decide what the C# PreviewManager shows.
 *
 * Shown: namespaces, type declarations (class, struct, record, interface, enum, delegate) and
 * their members (methods, constructors, operators, properties, indexers, events, fields). Method
 * bodies become `{ … }`, expression bodies `=> …`, initializers `= …`; one-line auto-property
 * accessors (`{ get; set; }`) are kept. Enum bodies are shown verbatim.
 *
 * Visibility: `public` is public; `protected` and `protected internal` are protected; `internal`,
 * `private`, `private protected` and no modifier are private. Interface members without a modifier
 * are public.
 */
export const CSHARP_RULES = {
  /** Leading attributes on the same line as a declaration, e.g. `[Fact] public void X()`. */
  leadingAttributes: /^(?:\[[^\]]*\]\s*)+/,
  /** A statement that is only an attribute (complete, or with its bracket left open). */
  attributeOnly: /^\[[^\]]*\]\s*$|^\[[^\]]*$/,
  docComment: /^\s*\/\/\//,
  /** Preprocessor lines (`#region`, `#if`, …). */
  preprocessor: /^\s*#/,

  modifiers:
    /^(?:(?:public|private|protected|internal|static|abstract|sealed|virtual|override|readonly|async|extern|unsafe|new|partial|const|volatile|required|file|ref)\s+)*/,
  publicModifier: /\bpublic\s/,
  privateProtected: /\bprivate\s+protected\s|\bprotected\s+private\s/,
  protectedModifier: /\bprotected\s/,
  anyAccessModifier: /\b(?:public|private|protected|internal)\s/,

  namespace: /^namespace\s+[\w.]+/,
  fileScopedNamespace: /^namespace\s+[\w.]+\s*;/,
  typeDeclaration: /^(?:class|struct|interface|enum|record(?:\s+(?:class|struct))?|delegate)\b/,
  enumDeclaration: /^enum\b/,
  interfaceDeclaration: /^interface\b/,
  /** A member with a parameter list: method, constructor, operator, conversion. */
  method: /^[\w<>[\],.?\s()]*?(?:\boperator\s*\S+|\b[A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/,
  /** Starts of statements that are never members (using directives, stray code). */
  never: /^(?:using\b|extern\s+alias\b|global\s+using\b|[}{)\]])/,
} as const;

function accessLevel(modifiers: string, container: string): PeekVisibility {
  const R = CSHARP_RULES;
  if (R.publicModifier.test(modifiers)) return "public";
  if (R.privateProtected.test(modifiers)) return "private";
  if (R.protectedModifier.test(modifiers)) return "protected";
  if (container === "interface" && !R.anyAccessModifier.test(modifiers)) return "public";
  return "private";
}

function classify(text: string, container: string): BraceDecl | null {
  const R = CSHARP_RULES;
  const stripped = text.replace(R.leadingAttributes, "");
  if (stripped === "" || R.never.test(stripped)) return null;

  if (R.fileScopedNamespace.test(stripped)) return { visibility: "public", body: "hidden" };
  if (R.namespace.test(stripped)) return { visibility: "public", body: "members", childContainer: "namespace" };

  const modifiers = (R.modifiers.exec(stripped)?.[0] ?? "") + " ";
  const rest = stripped.slice(modifiers.length - 1);
  const visibility = accessLevel(modifiers, container);

  if (R.typeDeclaration.test(rest)) {
    if (R.enumDeclaration.test(rest)) return { visibility, body: "verbatim" };
    const childContainer = R.interfaceDeclaration.test(rest) ? "interface" : "type";
    return { visibility, body: "members", childContainer };
  }

  // Outside a type, anything else is a top-level statement (C# 9 scripts) — never shown.
  if (container === "top" || container === "namespace") return null;

  if (R.method.test(rest)) return { visibility, body: "hidden", cutAt: ["arrow"] };
  // Property, indexer, event or field.
  return { visibility, body: "hidden", cutAt: ["assign", "arrow"], inlineBody: true };
}

export const CSHARP_LANGUAGE: BraceLanguage = {
  docComment: CSHARP_RULES.docComment,
  attributeOnly: CSHARP_RULES.attributeOnly,
  ignoredLine: CSHARP_RULES.preprocessor,
  asi: false,
  tsLexing: false,
  csLexing: true,
  classify,
};

export class CSharpPreviewManager implements PreviewManager {
  readonly language = "csharp";
  readonly extensions = [".cs"] as const;

  preview(lines: readonly string[], opts: PreviewOptions): PeekLine[] {
    return previewBraceLanguage(CSHARP_LANGUAGE, lines, opts);
  }
}
