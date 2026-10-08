import type { PeekLine, PreviewManager, PreviewOptions } from "./types.ts";

/**
 * The regexes that decide what the Markdown PreviewManager shows. Only headings are emitted; every
 * other line (paragraphs, lists, tables, code) is dropped, so the result reads as a table of
 * contents.
 */
export const MARKDOWN_RULES = {
  /** `# Title` … `###### Title` (up to 3 leading spaces, per CommonMark). Group 1 = the hashes. */
  atxHeading: /^ {0,3}(#{1,6})(?:[ \t]+.*)?$/,
  /** Setext underline for a level-1 heading (`Title` then `===`). */
  setextH1: /^ {0,3}=+[ \t]*$/,
  /** Setext underline for a level-2 heading (`Title` then `---`). */
  setextH2: /^ {0,3}-+[ \t]*$/,
  /** Opening/closing code fence. Group 1 = the fence run (``` or ~~~, at least three). */
  fence: /^ {0,3}(`{3,}|~{3,})/,
  /** YAML front matter delimiter — only honored as the very first line. */
  frontMatter: /^---[ \t]*$/,
  /** Lines that can't be the text line of a setext heading (lists, quotes, tables, html). */
  notSetextText: /^ {0,3}(?:[-*+>|<]|\d+[.)]\s)/,
  htmlCommentOpen: /^ {0,3}<!--/,
  htmlCommentClose: /-->/,
} as const;

export class MarkdownPreviewManager implements PreviewManager {
  readonly language = "markdown";
  readonly extensions = [".md", ".markdown", ".mdx"] as const;

  preview(lines: readonly string[], opts: PreviewOptions): PeekLine[] {
    const R = MARKDOWN_RULES;
    const out: PeekLine[] = [];
    let fence: string | null = null;
    let inHtmlComment = false;
    let start = 0;

    if (lines.length > 0 && R.frontMatter.test(lines[0] ?? "")) {
      const end = lines.findIndex((l, i) => i > 0 && R.frontMatter.test(l));
      if (end > 0) start = end + 1;
    }

    for (let i = start; i < lines.length; i++) {
      const line = lines[i] ?? "";

      if (fence !== null) {
        const m = R.fence.exec(line);
        if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length && line.trim() === m[1]) fence = null;
        continue;
      }
      if (inHtmlComment) {
        if (R.htmlCommentClose.test(line)) inHtmlComment = false;
        continue;
      }

      const fenceMatch = R.fence.exec(line);
      if (fenceMatch) {
        fence = fenceMatch[1]!;
        continue;
      }
      if (R.htmlCommentOpen.test(line)) {
        if (!R.htmlCommentClose.test(line)) inHtmlComment = true;
        continue;
      }

      const atx = R.atxHeading.exec(line);
      if (atx) {
        if (atx[1]!.length <= opts.maxDepth) out.push({ line: i + 1, text: line.trimEnd() });
        continue;
      }

      // Setext: a non-blank paragraph line directly followed by a === / --- underline.
      const next = lines[i + 1];
      if (next !== undefined && line.trim() !== "" && !R.notSetextText.test(line)) {
        const level = R.setextH1.test(next) ? 1 : R.setextH2.test(next) ? 2 : 0;
        if (level > 0) {
          if (level <= opts.maxDepth) {
            out.push({ line: i + 1, text: line.trimEnd() });
            out.push({ line: i + 2, text: next.trimEnd() });
          }
          i++; // the underline is consumed either way
        }
      }
    }
    return out;
  }
}
