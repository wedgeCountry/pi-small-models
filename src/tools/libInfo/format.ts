import type { ApiEntry, LibExtraction, LibQueryOptions, LibraryInfo } from "./types.ts";
import { qualifiedName, selectView, type LibView } from "./query.ts";

/** Same caps as `read`/`peek`, so one call can't flood a small model's context. */
export const MAX_OUTPUT_LINES = 2000;
export const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_LISTED_MODULES = 40;
const MAX_SIGNATURE_CHARS_IN_LIST = 300;

export interface LibRenderResult {
  text: string;
  view: LibView["view"];
  truncated: boolean;
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((l) => (l.trim() === "" ? "" : prefix + l))
    .join("\n");
}

function firstDocLine(docs: string | undefined): string | undefined {
  if (!docs) return undefined;
  const para = docs.trim().split(/\n\s*\n/)[0] ?? "";
  const line = para.replace(/\s+/g, " ").trim();
  if (!line) return undefined;
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

function clip(signature: string, max: number): string {
  return signature.length > max ? `${signature.slice(0, max - 1)}…` : signature;
}

function title(info: LibraryInfo): string {
  return `${info.name}${info.version ? ` ${info.version}` : ""} (${info.ecosystem})${info.module ? ` — module ${info.module}` : ""}`;
}

function header(info: LibraryInfo): string[] {
  const out = [title(info)];
  if (info.location) out.push(`Location: ${info.location}`);
  if (info.apiSource?.length) out.push(`API read from: ${info.apiSource.join(", ")}`);
  if (info.summary) out.push(`Summary: ${info.summary.replace(/\s+/g, " ").trim()}`);
  if (info.dependencies?.length) out.push(`Dependencies: ${info.dependencies.join(", ")}`);
  if (info.modules?.length) {
    const shown = info.modules.slice(0, MAX_LISTED_MODULES).join(", ");
    const more = info.modules.length > MAX_LISTED_MODULES ? ` (+${info.modules.length - MAX_LISTED_MODULES} more)` : "";
    out.push(`Modules: ${shown}${more}`);
  }
  for (const note of info.notes ?? []) out.push(`Note: ${note}`);
  return out;
}

function listLine(e: ApiEntry, memberCounts: Map<string, number>, includeDocs: boolean, withContainer: boolean): string[] {
  const members = memberCounts.get(qualifiedName(e)) ?? 0;
  const where = withContainer && e.container ? `  [in ${e.container}]` : "";
  const out = [`  ${clip(e.signature, MAX_SIGNATURE_CHARS_IN_LIST)}${members ? `  (+${members} members)` : ""}${where}`];
  // Lists stay one line per entry unless docs were asked for; the symbol view always shows them.
  if (includeDocs && e.docs) out.push(indent(e.docs.trim(), "      "));
  return out;
}

function location(e: ApiEntry): string | undefined {
  if (!e.source) return undefined;
  return e.line ? `${e.source}:${e.line}` : e.source;
}

function renderView(ex: LibExtraction, view: LibView, opts: LibQueryOptions): string[] {
  const includeDocs = opts.includeDocs ?? false;
  const out: string[] = [];

  switch (view.view) {
    case "overview": {
      out.push(...header(ex.info), "");
      if (view.total === 0) {
        out.push("No public API entries found.");
        break;
      }
      const what = ex.rootContainer ? `Contents of ${ex.rootContainer}` : "Exports";
      out.push(`${what} (${view.total}${view.entries.length < view.total ? `, showing ${view.entries.length}` : ""}):`);
      for (const e of view.entries) out.push(...listLine(e, view.memberCounts, includeDocs, false));
      out.push("");
      if (view.entries.length < view.total) {
        out.push(`[Showing ${view.entries.length} of ${view.total}. Use query="…" to search, or raise maxResults.]`);
      }
      out.push(`Next: symbol="Name" (or "Type.member") for exact signatures and docs; query="text" to search all names.`);
      break;
    }
    case "search": {
      out.push(title(ex.info), "");
      if (view.total === 0) {
        out.push(`No names contain "${view.query}". Call without query for an overview${ex.info.modules?.length ? ", or try another module" : ""}.`);
        break;
      }
      out.push(`Matches for "${view.query}" (${view.total}${view.entries.length < view.total ? `, showing ${view.entries.length}` : ""}):`);
      for (const e of view.entries) out.push(...listLine(e, view.memberCounts, includeDocs, true));
      out.push("");
      if (view.entries.length < view.total) out.push(`[Showing ${view.entries.length} of ${view.total}. Use a more specific query.]`);
      out.push(`Next: symbol="Container.name" for full details of one match.`);
      break;
    }
    case "symbol": {
      out.push(title(ex.info), "");
      for (const group of view.groups) {
        out.push(`== ${group.name}${group.declarations.length > 1 ? ` (${group.declarations.length} declarations)` : ""}`);
        for (const d of group.declarations) {
          out.push(d.signature);
          const loc = location(d);
          if (loc) out.push(`  Source: ${loc}`);
          if (d.reexportedFrom) out.push(`  Re-exported from: ${d.reexportedFrom}`);
          if (d.docs?.trim()) out.push("", indent(d.docs.trim(), "  "));
          out.push("");
        }
        if (group.memberTotal > 0) {
          out.push(`Members (${group.memberTotal}${group.members.length < group.memberTotal ? `, showing ${group.members.length}` : ""}):`);
          for (const m of group.members) {
            const nested = view.memberCounts.get(qualifiedName(m)) ?? 0;
            out.push(`  ${clip(m.signature, MAX_SIGNATURE_CHARS_IN_LIST)}${nested ? `  (+${nested} members)` : ""}`);
            if (includeDocs && m.docs) out.push(indent(m.docs.trim(), "      "));
            else {
              const summary = firstDocLine(m.docs);
              if (summary) out.push(`      // ${summary}`);
            }
          }
          out.push("");
        }
      }
      break;
    }
    case "ambiguous": {
      out.push(title(ex.info), "");
      out.push(`"${view.symbol}" matches several names — call again with one of these as symbol:`);
      for (const c of view.candidates) out.push(`  ${qualifiedName(c)}    ${clip(c.signature, 160)}`);
      break;
    }
    case "notFound": {
      out.push(title(ex.info), "");
      out.push(`No symbol "${view.symbol}" found${ex.info.module ? ` in module ${ex.info.module}` : ""}.`);
      if (view.suggestions.length) {
        out.push("Similar names:");
        for (const s of view.suggestions) out.push(`  ${qualifiedName(s)}    ${clip(s.signature, 160)}`);
      } else {
        out.push(`Call without symbol for an overview${ex.info.modules?.length ? `, or pass module= (one of: ${ex.info.modules.slice(0, 10).join(", ")})` : ""}.`);
      }
      for (const note of ex.info.notes ?? []) out.push(`Note: ${note}`);
      break;
    }
  }
  return out;
}

/** Caps rendered lines at `MAX_OUTPUT_LINES` / `MAX_OUTPUT_BYTES`, appending a hint when cut. */
export function capOutput(lines: string[]): { text: string; truncated: boolean } {
  const flat = lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd().split("\n");
  let truncated = false;
  let kept = flat;
  if (kept.length > MAX_OUTPUT_LINES) {
    kept = kept.slice(0, MAX_OUTPUT_LINES);
    truncated = true;
  }
  let bytes = 0;
  for (let i = 0; i < kept.length; i++) {
    bytes += Buffer.byteLength(kept[i]!, "utf8") + 1;
    if (bytes > MAX_OUTPUT_BYTES && i > 0) {
      kept = kept.slice(0, i);
      truncated = true;
      break;
    }
  }
  if (truncated) kept.push("", "[Output truncated. Narrow it with module=, symbol= or query=, or lower maxResults.]");
  return { text: kept.join("\n"), truncated };
}

/** Selects the view for `opts` and renders it as capped plain text. */
export function renderLibrary(ex: LibExtraction, opts: LibQueryOptions = {}): LibRenderResult {
  const view = selectView(ex, opts);
  const { text, truncated } = capOutput(renderView(ex, view, opts));
  return { text, view: view.view, truncated };
}
