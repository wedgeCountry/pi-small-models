import type { PeekLine, PreviewManager, PreviewOptions } from "./types.ts";

/**
 * Outlines structured config/data files (JSON, YAML, TOML) by their top-level structure only:
 * top-level keys (YAML/TOML `key:` lines, JSON `"key":` at bracket depth 0) and TOML table
 * headers. Nested values are dropped, so a large config collapses to its table of contents.
 */
export class StructuredDataPreviewManager implements PreviewManager {
  readonly language: string;
  readonly extensions: readonly string[];

  constructor(language: string, extensions: readonly string[], private readonly kind: "json" | "yaml" | "toml") {
    this.language = language;
    this.extensions = extensions;
  }

  preview(lines: readonly string[], _opts: PreviewOptions): PeekLine[] {
    const out: PeekLine[] = [];
    if (this.kind === "json") {
      let depth = 0;
      let started = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        // Depth *before* this line: a top-level member sits directly inside the root braces.
        const depthBefore = depth;
        for (const ch of line) {
          if (ch === "{" || ch === "[") {
            depth++;
            started = true;
          } else if (ch === "}" || ch === "]") {
            depth--;
          }
        }
        const m = line.match(/^\s{0,4}"((?:[^"\\]|\\.)*)"\s*:/);
        if (m && started && depthBefore === 1) {
          out.push({ line: i + 1, text: `"${m[1]}":` });
        }
      }
      return out;
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (this.kind === "toml") {
        const table = line.match(/^\s{0,3}(\[\[[^\]]*\]\]|\[[^\]]*\])\s*$/);
        if (table) {
          out.push({ line: i + 1, text: table[1]! });
          continue;
        }
        const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s/);
        if (kv) out.push({ line: i + 1, text: `${kv[1]!} =` });
      } else {
        const kv = line.match(/^([A-Za-z0-9_$.-]+[A-Za-z0-9_$-])\s*:(\s|$)/);
        if (kv) out.push({ line: i + 1, text: `${kv[1]!}:` });
      }
    }
    return out;
  }
}
