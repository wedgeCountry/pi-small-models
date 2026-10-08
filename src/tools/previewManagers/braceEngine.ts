import { isVisibleAt, type PeekLine, type PeekVisibility, type PreviewOptions } from "./types.ts";

/**
 * A small outline scanner shared by the brace-delimited languages (TypeScript/JavaScript and C#).
 * It is *not* a parser: it tracks just enough lexical state (strings, comments, template and
 * interpolation holes, regex literals) to count `{}`/`()`/`[]` reliably, splits code into
 * statements, and asks the language's regex table (`BraceLanguage.classify`) what each statement
 * is and whether it may be shown.
 *
 * One frame is pushed per open `{`:
 * - `members`  — a class/namespace/top-level body: every statement inside is classified.
 * - `verbatim` — an interface/enum/type-literal body: every line is shown as written.
 * - `body`     — a function body or a hidden declaration's body: nothing inside is shown.
 * - `inner`    — a brace that belongs to the enclosing statement's own text (a destructured
 *   parameter, an object literal in an initializer); transparent to statement tracking.
 */

export type BodyKind = "members" | "verbatim" | "hidden";

export interface BraceDecl {
  visibility: PeekVisibility;
  /** What a `{` that opens this declaration's body contains. */
  body: BodyKind;
  /**
   * Where the shown header stops besides the body `{` or the terminating `;`:
   * `"assign"` cuts after a depth-0 `=` (initializers), `"arrow"` after a depth-0 `=>` (arrow
   * functions, expression-bodied members). With both, `=` only cuts when no arrow function follows.
   */
  cutAt?: readonly ("assign" | "arrow")[];
  /** Keep a body that opens and closes on the header line (C# `{ get; set; }`). */
  inlineBody?: boolean;
  /** Container kind handed to the statements inside a `members` body. */
  childContainer?: string;
}

export interface BraceLanguage {
  /** A line starting a doc comment (`/**`, `///`). Consecutive matching lines form one block. */
  readonly docComment: RegExp;
  /** Statement text that is only a decorator/attribute (it attaches to the next declaration). */
  readonly attributeOnly: RegExp;
  /** Lines skipped entirely at statement boundaries (e.g. C# `#region`/`#if`). */
  readonly ignoredLine?: RegExp;
  /** TS: automatic semicolon insertion — a statement may end at a line break. */
  readonly asi: boolean;
  /** TS: backtick template literals with `${}` holes, and `/regex/` literals. */
  readonly tsLexing: boolean;
  /** C#: `@"..."`, `$"..."` and `"""raw"""` strings. */
  readonly csLexing: boolean;
  /**
   * Classifies a statement from its first line (starting at its first significant character).
   * `container` is the kind of the enclosing `members` frame (`"top"` at file level). Returns
   * `null` for statements that are never shown (imports, plain code, closing braces, ...).
   */
  classify(text: string, container: string): BraceDecl | null;
}

type FrameType = "members" | "verbatim" | "body" | "inner";

interface Statement {
  decl: BraceDecl | null;
  shown: boolean;
  phase: "header" | "tail";
  isAttribute: boolean;
  bodyOpenLine: number;
}

interface Frame {
  type: FrameType;
  container: string;
  stmt: Statement | null;
  /** The statement whose body this frame is (closing the frame completes it). */
  owner: Statement | null;
  savedParen: number;
}

type LexMode =
  | { t: "hole"; depth: number }
  | { t: "str"; close: string; escape: boolean; doubled: boolean; hole: "${" | "{" | null; multiline: boolean }
  | { t: "comment" };

/** Previous significant chars after which `/` starts a regex literal rather than a division (TS). */
const REGEX_PRECEDERS = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", ">", "~", "^"]);
const REGEX_KEYWORDS = /\b(?:return|typeof|case|in|of|delete|void|throw|new|yield|await)$/;

/** A TS line ending like this surely continues on the next line. */
const ASI_CONTINUES_AFTER = /(?:[,([{=|&:.?+\-*/<!]|=>|\b(?:extends|implements|keyof|typeof|new|in|of|as))\s*$/;
/** A TS line starting like this continues the previous one. */
const ASI_CONTINUES_BEFORE = /^\s*(?:[|&.?:={)\]>,]|=>|extends\b|implements\b|as\b)/;

/** Operators whose `=` is not an assignment (`==`, `<=`, `+=` …). */
const NOT_ASSIGN_BEFORE = /[=!<>+\-*/%&|^?]/;

interface Segment {
  start: number;
  end: number;
  suffix: string;
}

const BODY_PLACEHOLDER = "{ … }";

export function previewBraceLanguage(lang: BraceLanguage, lines: readonly string[], opts: PreviewOptions): PeekLine[] {
  const out: PeekLine[] = [];
  const root: Frame = { type: "members", container: "top", stmt: null, owner: null, savedParen: 0 };
  const frames: Frame[] = [root];
  const lex: LexMode[] = [];
  let paren = 0;
  let pendingDoc: PeekLine[] = [];
  let docBlockOpen = false;
  let pendingAttrs: PeekLine[] = [];

  const top = () => frames[frames.length - 1]!;
  const owningFrame = (): Frame => {
    for (let k = frames.length - 1; k >= 0; k--) if (frames[k]!.type !== "inner") return frames[k]!;
    return root;
  };
  const insideHiddenBody = () => frames.some((f) => f.type === "body");

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    const startsInComment = lex.length > 0 && lex[lex.length - 1]!.t === "comment";
    const startsInString = lex.length > 0 && !startsInComment;
    const owner0 = owningFrame();
    const hidden0 = insideHiddenBody();
    const segments: Segment[] = [];
    let lineSeg: Segment | null = null;
    let closesOnLine = 0;

    // --- Doc comments, at statement boundaries of a members frame.
    const atBoundary = owner0.type === "members" && owner0.stmt === null && !hidden0 && !startsInString;
    if (atBoundary) {
      if (startsInComment) {
        if (docBlockOpen) pendingDoc.push({ line: li + 1, text: line.trimEnd() });
      } else if (lang.ignoredLine?.test(line)) {
        continue;
      } else if (lang.docComment.test(line)) {
        const last = pendingDoc[pendingDoc.length - 1];
        if (last && last.line === li) pendingDoc.push({ line: li + 1, text: line.trimEnd() });
        else pendingDoc = [{ line: li + 1, text: line.trimEnd() }];
        docBlockOpen = true;
      } else {
        docBlockOpen = false;
      }
    } else {
      docBlockOpen = false;
    }

    // --- Lines shown because of the frame/statement they continue.
    const ownerStmt = owner0.type === "members" ? owner0.stmt : null;
    if (ownerStmt && !hidden0) {
      if (ownerStmt.isAttribute) {
        if (ownerStmt.shown) pendingAttrs.push({ line: li + 1, text: line.trimEnd() });
      } else if (ownerStmt.phase === "header" && ownerStmt.shown) {
        lineSeg = { start: 0, end: line.trimEnd().length, suffix: "" };
        segments.push(lineSeg);
      }
    } else if (owner0.type === "verbatim" && !hidden0) {
      const trimmed = line.trimStart();
      const isComment = startsInComment || trimmed.startsWith("//") || trimmed.startsWith("/*");
      const isClosingOnly = /^[}\])\s;,]*$/.test(trimmed);
      if (trimmed !== "" && !isClosingOnly && (!isComment || opts.includeDocs)) {
        segments.push({ start: 0, end: line.trimEnd().length, suffix: "" });
      }
    }

    const cutHere = (end: number, suffix: string) => {
      if (lineSeg) {
        lineSeg.end = end;
        lineSeg.suffix = suffix;
      }
    };

    const startStatement = (at: number) => {
      const f = top();
      if (f.type !== "members" || f.stmt !== null) return;
      const text = line.slice(at);
      const hidden = insideHiddenBody();
      if (lang.attributeOnly.test(text)) {
        f.stmt = { decl: null, shown: !hidden, phase: "header", isAttribute: true, bodyOpenLine: -1 };
        if (!hidden) pendingAttrs.push({ line: li + 1, text: line.trimEnd() });
        return;
      }
      const decl = hidden ? null : lang.classify(text, f.container);
      const shown = decl !== null && isVisibleAt(decl.visibility, opts.visibility);
      f.stmt = { decl, shown, phase: "header", isAttribute: false, bodyOpenLine: -1 };
      if (shown) {
        if (opts.includeDocs) out.push(...pendingDoc);
        out.push(...pendingAttrs);
        const lineStart = line.slice(0, at).trim() === "" ? 0 : at; // keep indentation
        lineSeg = { start: lineStart, end: line.trimEnd().length, suffix: "" };
        segments.push(lineSeg);
      }
      pendingDoc = [];
      pendingAttrs = [];
    };

    // --- Character scan.
    let prevSig = "";
    let i = 0;
    while (i < line.length) {
      const mode = lex[lex.length - 1];

      if (mode?.t === "comment") {
        const close = line.indexOf("*/", i);
        if (close < 0) break;
        lex.pop();
        i = close + 2;
        continue;
      }

      if (mode?.t === "str") {
        const ch = line[i]!;
        if (mode.escape && ch === "\\") i += 2;
        else if (mode.doubled && ch === '"' && line[i + 1] === '"') i += 2;
        else if (mode.hole === "${" && line.startsWith("${", i)) {
          lex.push({ t: "hole", depth: 0 });
          i += 2;
        } else if (mode.hole === "{" && ch === "{") {
          if (line[i + 1] === "{") i += 2;
          else {
            lex.push({ t: "hole", depth: 0 });
            i++;
          }
        } else if (line.startsWith(mode.close, i)) {
          lex.pop();
          i += mode.close.length;
          prevSig = "x";
        } else i++;
        continue;
      }

      // Code mode: base level, or inside a template/interpolation hole.
      const ch = line[i]!;
      if (ch === " " || ch === "\t" || ch === "\r") {
        i++;
        continue;
      }
      if (line.startsWith("//", i)) break;
      if (line.startsWith("/*", i)) {
        lex.push({ t: "comment" });
        i += 2;
        continue;
      }

      const inHole = mode?.t === "hole";
      if (!inHole) startStatement(i);

      if (lang.csLexing) {
        const m = /^(\$*@?\$*)("""|")/.exec(line.slice(i));
        if (m && (m[1]!.length > 0 || ch === '"')) {
          const prefix = m[1]!;
          const raw = m[2] === '"""';
          lex.push({
            t: "str",
            close: m[2]!,
            escape: !raw && !prefix.includes("@"),
            doubled: prefix.includes("@"),
            hole: prefix.includes("$") ? "{" : null,
            multiline: raw || prefix.includes("@"),
          });
          i += m[0].length;
          continue;
        }
      }
      if (ch === '"' || ch === "'") {
        lex.push({ t: "str", close: ch, escape: true, doubled: false, hole: null, multiline: false });
        i++;
        continue;
      }
      if (lang.tsLexing && ch === "`") {
        lex.push({ t: "str", close: "`", escape: true, doubled: false, hole: "${", multiline: true });
        i++;
        continue;
      }
      if (lang.tsLexing && ch === "/" && (REGEX_PRECEDERS.has(prevSig) || REGEX_KEYWORDS.test(line.slice(0, i).trimEnd()))) {
        let j = i + 1;
        let inClass = false;
        while (j < line.length) {
          const c = line[j]!;
          if (c === "\\") {
            j += 2;
            continue;
          }
          if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) break;
          j++;
        }
        i = j + 1;
        while (i < line.length && /[a-z]/i.test(line[i]!)) i++;
        prevSig = "x";
        continue;
      }

      if (inHole) {
        const hole = mode;
        if (ch === "{") hole.depth++;
        else if (ch === "}") {
          if (hole.depth === 0) lex.pop();
          else hole.depth--;
        }
        prevSig = ch;
        i++;
        continue;
      }

      const f = top();
      const stmt = f.type === "members" ? f.stmt : null;

      if (ch === "(" || ch === "[") paren++;
      else if (ch === ")" || ch === "]") paren = Math.max(0, paren - 1);
      else if (ch === "{") {
        let type: FrameType = "inner";
        let container = f.container;
        let owner: Statement | null = null;
        if (stmt && stmt.phase === "header" && paren === 0 && !stmt.isAttribute) {
          const body = stmt.decl?.body ?? "hidden";
          owner = stmt;
          stmt.bodyOpenLine = li;
          stmt.phase = "tail";
          if (body === "members" && stmt.shown) {
            type = "members";
            container = stmt.decl?.childContainer ?? container;
            cutHere(i + 1, "");
          } else if (body === "verbatim" && stmt.shown) {
            type = "verbatim"; // shown as written, so a one-line `enum E { A, B }` stays whole
          } else {
            type = "body";
            cutHere(i, " " + BODY_PLACEHOLDER);
          }
        } else if (f.type === "verbatim" || f.type === "body") {
          type = f.type;
        }
        frames.push({ type, container, stmt: null, owner, savedParen: paren });
        paren = 0;
      } else if (ch === "}") {
        if (frames.length > 1) {
          const closed = frames.pop()!;
          paren = closed.savedParen;
          const parent = top();
          const s = closed.owner;
          // A one-line container (`class A { void F() {} }`) gets its closing brace back.
          if (s?.shown && closed.type === "members" && s.bodyOpenLine === li) closesOnLine++;
          if (s && parent.stmt === s) {
            if (s.decl?.inlineBody && s.bodyOpenLine === li) {
              cutHere(i + 1, "");
              // `{ get; set; } = value;` continues to its `;`; otherwise the member ends here.
              if (!/^\s*=[^=>]/.test(line.slice(i + 1))) parent.stmt = null;
            } else {
              parent.stmt = null;
            }
          }
        }
      } else if (ch === ";" && paren === 0 && stmt) {
        if (stmt.phase === "header") cutHere(i + 1, "");
        f.stmt = null;
      } else if (ch === "=" && stmt && stmt.phase === "header" && paren === 0 && stmt.decl) {
        const cut = stmt.decl.cutAt ?? [];
        if (line[i + 1] === ">") {
          if (cut.includes("arrow")) {
            cutHere(i + 2, " …");
            stmt.phase = "tail";
          }
          i += 2;
          prevSig = ">";
          continue;
        }
        const isAssign = line[i + 1] !== "=" && !NOT_ASSIGN_BEFORE.test(line[i - 1] ?? "");
        if (isAssign && cut.includes("assign")) {
          const rest = line.slice(i + 1);
          const arrowFollows = cut.includes("arrow") && (/=>/.test(rest) || /^\s*(?:async\s+)?(?:\(|<|function\b)/.test(rest));
          if (!arrowFollows) {
            cutHere(i + 1, " …");
            stmt.phase = "tail";
          }
        }
      }
      prevSig = ch;
      i++;
    }

    // Unterminated single-line strings end with the line.
    while (lex.length > 0) {
      const m = lex[lex.length - 1]!;
      if (m.t === "str" && !m.multiline) lex.pop();
      else break;
    }

    // --- End-of-line statement boundaries.
    const f = top();
    if (f.type === "members" && f.stmt && paren === 0 && lex.length === 0) {
      if (f.stmt.isAttribute) {
        f.stmt = null; // attribute lines attach to the next declaration
      } else if (lang.asi) {
        const code = line.replace(/\/\/.*$/, "").trimEnd();
        let next = "";
        for (let k = li + 1; k < lines.length; k++) {
          const t = lines[k]!.trim();
          if (t !== "" && !t.startsWith("//")) {
            next = lines[k]!;
            break;
          }
        }
        if (code !== "" && !ASI_CONTINUES_AFTER.test(code) && !ASI_CONTINUES_BEFORE.test(next)) f.stmt = null;
      }
    }

    // --- Emit this line.
    if (segments.length === 0) continue;
    const text = segments
      .map((s) => {
        const head = line.slice(s.start, Math.max(s.start, s.end));
        return head.trim() === "" ? head + s.suffix.trimStart() : head.trimEnd() + s.suffix;
      })
      .join(" ")
      .trimEnd() + " }".repeat(closesOnLine);
    const bare = text.trim();
    if (bare === "") continue;
    // Allman style: fold a lone `{` / `{ … }` into the header line above it.
    const prev = out[out.length - 1];
    if ((bare === "{" || bare === BODY_PLACEHOLDER) && prev && prev.line === li) {
      if (bare === BODY_PLACEHOLDER) prev.text += " " + BODY_PLACEHOLDER;
      continue;
    }
    if (bare === "{") continue;
    out.push({ line: li + 1, text });
  }

  return out;
}
