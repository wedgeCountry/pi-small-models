import { isVisibleAt, narrowest, type PeekLine, type PeekVisibility, type PreviewManager, type PreviewOptions } from "./types.ts";

/**
 * The regexes that decide what the Python PreviewManager shows.
 *
 * Shown: `class`/`def`/`async def` signatures (all lines of a multi-line signature, cut right after
 * the closing `:` so a one-line body is never included) plus their decorators, at module level and
 * nested inside classes. Never shown: function bodies, functions nested inside functions, and
 * module-level statements (imports, constants, `if __name__ == ...` blocks).
 *
 * Visibility is name-based: `__dunder__` and plain names are public, `_name` is protected, and
 * name-mangled `__name` is private. A member is only as visible as its narrowest enclosing class.
 */
export const PYTHON_RULES = {
  /** Group 1 = indentation, group 2 = name. */
  classDef: /^(\s*)class\s+([A-Za-z_]\w*)/,
  /** Group 1 = indentation, group 2 = name. */
  functionDef: /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)/,
  decorator: /^\s*@/,
  /** A statement consisting of a (possibly prefixed) string literal: a docstring candidate. */
  docstring: /^\s*[rRuUbBfF]{0,2}(?:"""|'''|"|')/,
  dunderName: /^__\w+__$/,
  privateName: /^__\w+$/,
  protectedName: /^_\w*$/,
} as const;

function nameVisibility(name: string): PeekVisibility {
  const R = PYTHON_RULES;
  if (R.dunderName.test(name)) return "public";
  if (R.privateName.test(name)) return "private";
  if (R.protectedName.test(name)) return "protected";
  return "public";
}

/** Lexical state carried from one physical line to the next. */
interface LexState {
  /** Open triple-quote delimiter, if a triple-quoted string spans the line break. */
  triple: string | null;
  /** Open (, [, { depth — a logical line continues while > 0. */
  depth: number;
  /** Line ended with a backslash continuation. */
  backslash: boolean;
}

interface LineScan {
  end: LexState;
  /** Index just past the first `:` at bracket depth 0 (relative to the logical line), or -1. */
  colonAt: number;
}

/**
 * Scans one physical line for strings, comments and brackets, starting from `state`. `trackColon`
 * records the first depth-0 `:` (the end of a def/class header).
 */
function scanLine(line: string, state: LexState, trackColon: boolean): LineScan {
  let { triple, depth } = state;
  let colonAt = -1;
  let i = 0;
  while (i < line.length) {
    if (triple) {
      const close = line.indexOf(triple, i);
      if (close < 0) return { end: { triple, depth, backslash: false }, colonAt };
      // Skip escaped delimiters such as \""" inside the string.
      if (close > 0 && line[close - 1] === "\\") {
        i = close + 1;
        continue;
      }
      i = close + 3;
      triple = null;
      continue;
    }
    const ch = line[i]!;
    if (ch === "#") break;
    if (ch === '"' || ch === "'") {
      const three = line.slice(i, i + 3);
      if (three === '"""' || three === "'''") {
        triple = three;
        i += 3;
        continue;
      }
      // Single-line string: skip to its closing quote.
      i++;
      while (i < line.length && line[i] !== ch) i += line[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === ":" && depth === 0 && trackColon && colonAt < 0) colonAt = i + 1;
    i++;
  }
  const backslash = !triple && /\\\s*$/.test(line.replace(/#.*$/, ""));
  return { end: { triple, depth, backslash }, colonAt };
}

interface Scope {
  indent: number;
  kind: "class" | "function";
  /** Effective visibility (narrowest along the enclosing chain). */
  visibility: PeekVisibility;
  /** True when this scope's own header was emitted. */
  shown: boolean;
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

export class PythonPreviewManager implements PreviewManager {
  readonly language = "python";
  readonly extensions = [".py", ".pyi"] as const;

  preview(lines: readonly string[], opts: PreviewOptions): PeekLine[] {
    const R = PYTHON_RULES;
    const out: PeekLine[] = [];
    const scopes: Scope[] = [];
    let state: LexState = { triple: null, depth: 0, backslash: false };
    let pendingDecorators: PeekLine[] = [];
    /** Set right after a header (or at file start): the next logical line may be its docstring. */
    let docTarget: { indent: number; shown: boolean } | null = { indent: -1, shown: true };

    let i = 0;
    while (i < lines.length) {
      const first = lines[i]!;
      // Blank and comment-only lines never start a logical line or close a scope.
      if (first.trim() === "" || first.trimStart().startsWith("#")) {
        i++;
        continue;
      }

      // Collect one logical line: physical lines joined by open brackets/strings/backslashes.
      const start = i;
      const indent = indentOf(first);
      const isDef = R.classDef.exec(first) ?? R.functionDef.exec(first);
      let colonLine = -1;
      let colonAt = -1;
      do {
        const scan = scanLine(lines[i]!, state, isDef !== null && colonLine < 0);
        if (scan.colonAt >= 0 && colonLine < 0) {
          colonLine = i;
          colonAt = scan.colonAt;
        }
        state = scan.end;
        i++;
      } while (i < lines.length && (state.triple !== null || state.depth > 0 || state.backslash));
      const end = i; // exclusive

      while (scopes.length > 0 && indent <= scopes[scopes.length - 1]!.indent) scopes.pop();
      const parent = scopes[scopes.length - 1];

      // Docstring directly after a header (or as the first statement of the module).
      if (docTarget !== null) {
        const target = docTarget;
        docTarget = null;
        if (indent > target.indent && !isDef && R.docstring.test(first)) {
          if (opts.includeDocs && target.shown && !(parent?.kind === "function" && !parent.shown)) {
            for (let j = start; j < end; j++) out.push({ line: j + 1, text: lines[j]!.trimEnd() });
          }
          continue;
        }
      }

      // Inside a function body nothing is shown (nested defs included).
      if (parent?.kind === "function") {
        pendingDecorators = [];
        continue;
      }

      if (R.decorator.test(first)) {
        for (let j = start; j < end; j++) pendingDecorators.push({ line: j + 1, text: lines[j]!.trimEnd() });
        continue;
      }

      if (!isDef) {
        pendingDecorators = [];
        continue;
      }

      const kind: Scope["kind"] = R.classDef.test(first) ? "class" : "function";
      const own = nameVisibility(isDef[2]!);
      const visibility = parent ? narrowest(parent.visibility, own) : own;
      const shown = (parent ? parent.shown : true) && isVisibleAt(visibility, opts.visibility);

      if (shown) {
        out.push(...pendingDecorators);
        const lastHeaderLine = colonLine >= 0 ? colonLine : end - 1;
        for (let j = start; j <= lastHeaderLine; j++) {
          const raw = lines[j]!;
          const text = j === colonLine ? raw.slice(0, colonAt) : raw;
          out.push({ line: j + 1, text: text.trimEnd() });
        }
      }
      pendingDecorators = [];
      scopes.push({ indent, kind, visibility, shown });
      docTarget = { indent, shown };
    }
    return out;
  }
}
