/**
 * Shared types for `peek`'s per-language PreviewManagers (see registry.ts).
 *
 * A PreviewManager turns a file's lines into a short structural overview — signatures without
 * bodies for code, the heading outline for Markdown. Every manager is driven by a small table of
 * regular expressions declared at the top of its own file, so what `peek` shows for a language is
 * changed by editing that table rather than the scanning logic.
 */

/**
 * Inclusive visibility levels: `"public"` shows only public API, `"protected"` adds protected
 * members, `"private"` shows everything. How a language's own modifiers/naming conventions map
 * onto these three levels is documented in each manager's file.
 */
export type PeekVisibility = "public" | "protected" | "private";

export const PEEK_VISIBILITIES: readonly PeekVisibility[] = ["public", "protected", "private"];

const VISIBILITY_RANK: Record<PeekVisibility, number> = { public: 0, protected: 1, private: 2 };

/** True when a declaration of visibility `declared` should be shown at the requested level. */
export function isVisibleAt(declared: PeekVisibility, requested: PeekVisibility): boolean {
  return VISIBILITY_RANK[declared] <= VISIBILITY_RANK[requested];
}

/** The more restrictive of two visibilities (e.g. a public method of a protected class). */
export function narrowest(a: PeekVisibility, b: PeekVisibility): PeekVisibility {
  return VISIBILITY_RANK[a] >= VISIBILITY_RANK[b] ? a : b;
}

export interface PreviewOptions {
  /** Most-private level to include. Defaults to `"public"`. Ignored by the Markdown manager. */
  visibility: PeekVisibility;
  /** Include full docstrings / JSDoc / XML doc comments. Ignored by the Markdown manager. */
  includeDocs: boolean;
  /** Markdown only: deepest heading level to show (1-6). Ignored by code managers. */
  maxDepth: number;
}

/** One line of peek output — `line` is 1-indexed, matching `read`/`grep`/`insert`. */
export interface PeekLine {
  line: number;
  text: string;
}

export interface PreviewManager {
  /** Language name reported in the result, e.g. `"python"`. */
  readonly language: string;
  /** Lower-case file extensions (with the leading dot) this manager handles. */
  readonly extensions: readonly string[];
  preview(lines: readonly string[], opts: PreviewOptions): PeekLine[];
}
