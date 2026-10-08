import type { ApiEntry, LibExtraction, LibQueryOptions } from "./types.ts";

export const DEFAULT_OVERVIEW_RESULTS = 100;
export const DEFAULT_SEARCH_RESULTS = 50;
export const DEFAULT_MEMBER_RESULTS = 200;
/** A symbol lookup matching up to this many distinct names shows all of them instead of a "which one?" list. */
const MAX_SHOWN_MATCH_GROUPS = 3;

export function qualifiedName(e: ApiEntry): string {
  return e.container ? `${e.container}.${e.name}` : e.name;
}

export type LibView =
  | {
      view: "overview";
      entries: ApiEntry[];
      total: number;
      memberCounts: Map<string, number>;
    }
  | { view: "search"; query: string; entries: ApiEntry[]; total: number; memberCounts: Map<string, number> }
  | {
      view: "symbol";
      symbol: string;
      /** One group per distinct dotted name; each group holds that name's declarations (overloads). */
      groups: { name: string; declarations: ApiEntry[]; members: ApiEntry[]; memberTotal: number }[];
      memberCounts: Map<string, number>;
    }
  | { view: "ambiguous"; symbol: string; candidates: ApiEntry[] }
  | { view: "notFound"; symbol: string; suggestions: ApiEntry[] };

/**
 * Normalizes what a model is likely to type for a symbol: `Foo.bar()`, `Foo<T>.bar`,
 * `Foo::bar`, `Foo#bar`, `Foo.prototype.bar` all mean `Foo.bar`.
 */
export function normalizeSymbol(symbol: string): string {
  let s = symbol.trim();
  s = s.replace(/\(.*\)$/s, "");
  // Strip generic argument lists, innermost first, until none remain.
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/<[^<>]*>/g, "");
  }
  s = s.replace(/::|#/g, ".").replace(/\.prototype\./g, ".");
  return s.replace(/^\.+|\.+$/g, "");
}

function countMembers(entries: readonly ApiEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.container, (counts.get(e.container) ?? 0) + 1);
  return counts;
}

function groupByName(entries: readonly ApiEntry[]): Map<string, ApiEntry[]> {
  const groups = new Map<string, ApiEntry[]>();
  for (const e of entries) {
    const qn = qualifiedName(e);
    const list = groups.get(qn);
    if (list) list.push(e);
    else groups.set(qn, [e]);
  }
  return groups;
}

function findSymbol(entries: readonly ApiEntry[], symbol: string): ApiEntry[] {
  const passes: ((qn: string) => boolean)[] = [
    (qn) => qn === symbol,
    (qn) => qn.endsWith(`.${symbol}`),
    (qn) => qn.toLowerCase() === symbol.toLowerCase(),
    (qn) => qn.toLowerCase().endsWith(`.${symbol.toLowerCase()}`),
  ];
  for (const pass of passes) {
    const hits = entries.filter((e) => pass(qualifiedName(e)));
    if (hits.length > 0) return hits;
  }
  return [];
}

/** Lower score = better match. */
function searchScore(e: ApiEntry, q: string): number {
  const name = e.name.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  return 3; // only the container matched
}

function rankedSearch(entries: readonly ApiEntry[], query: string): ApiEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return entries
    .map((e, index) => ({ e, index, qn: qualifiedName(e) }))
    .filter(({ qn }) => qn.toLowerCase().includes(q))
    .sort(
      (a, b) =>
        searchScore(a.e, q) - searchScore(b.e, q) || a.qn.length - b.qn.length || a.index - b.index
    )
    .map(({ e }) => e);
}

/**
 * Picks which view to show for a library extraction:
 * - `symbol` set → the declarations of that symbol plus its members (or a "did you mean" list),
 * - `query` set → ranked name search,
 * - neither → overview of the root container's direct children.
 */
export function selectView(ex: LibExtraction, opts: LibQueryOptions = {}): LibView {
  const { entries } = ex;
  const memberCounts = countMembers(entries);

  if (opts.symbol !== undefined && opts.symbol.trim() !== "") {
    const symbol = normalizeSymbol(opts.symbol);
    const hits = findSymbol(entries, symbol);
    if (hits.length === 0) {
      const last = symbol.split(".").pop() ?? symbol;
      const suggestions = rankedSearch(entries, last).slice(0, 10);
      return { view: "notFound", symbol, suggestions };
    }
    const groups = groupByName(hits);
    if (groups.size > MAX_SHOWN_MATCH_GROUPS) {
      const candidates = [...groups.values()].map((g) => g[0]!).slice(0, opts.maxResults ?? DEFAULT_SEARCH_RESULTS);
      return { view: "ambiguous", symbol, candidates };
    }
    const maxMembers = opts.maxResults ?? DEFAULT_MEMBER_RESULTS;
    return {
      view: "symbol",
      symbol,
      memberCounts,
      groups: [...groups.entries()].map(([name, declarations]) => {
        const members = entries.filter((e) => e.container === name);
        return { name, declarations, members: members.slice(0, maxMembers), memberTotal: members.length };
      }),
    };
  }

  if (opts.query !== undefined && opts.query.trim() !== "") {
    const all = rankedSearch(entries, opts.query);
    return {
      view: "search",
      query: opts.query.trim(),
      entries: all.slice(0, opts.maxResults ?? DEFAULT_SEARCH_RESULTS),
      total: all.length,
      memberCounts,
    };
  }

  const top = entries.filter((e) => e.container === ex.rootContainer);
  return {
    view: "overview",
    entries: top.slice(0, opts.maxResults ?? DEFAULT_OVERVIEW_RESULTS),
    total: top.length,
    memberCounts,
  };
}
