/**
 * Shared shapes for the library tools (`ts_lib`, `py_lib`, `dotnet_lib`). Each tool only has to
 * *locate* a package and *extract* a flat list of `ApiEntry`s; `query.ts` and `format.ts` turn that
 * into the same three views for every language (overview / search / symbol detail).
 */

export type Ecosystem = "npm" | "python" | "nuget";

export interface ApiEntry {
  /** e.g. "class", "function", "method", "property", "interface", "type", "namespace", "module". */
  kind: string;
  /** Plain name, no generic parameters (matching is done on this). */
  name: string;
  /**
   * Dotted name of what contains this entry ("" for the root of the requested module). Members
   * of a class `Foo` have container "Foo"; for .NET, types have their namespace as container and
   * members the type's full name.
   */
  container: string;
  /** One declaration, as compact source-like text. Overloads are separate entries. */
  signature: string;
  /** Full documentation text (JSDoc / docstring / XML doc), already cleaned of comment syntax. */
  docs?: string;
  /** Where it's declared, for display — relative to the project root when inside it. */
  source?: string;
  /** 1-based line in `source`. */
  line?: number;
  /** Re-exported from somewhere else (TS `export … from`, Python `from .x import y`). */
  reexportedFrom?: string;
}

export interface LibraryInfo {
  ecosystem: Ecosystem;
  /** Package name as installed. */
  name: string;
  version?: string;
  /** Install location (project-relative when inside the project). */
  location?: string;
  /** The file or files the API was read from (types entry, module file, XML doc files). */
  apiSource?: string[];
  summary?: string;
  /** Direct dependencies, as "name range" strings. */
  dependencies?: string[];
  /** Importable sub-entry points: subpath exports, submodules, or namespaces. */
  modules?: string[];
  /** The module/namespace this result is scoped to, if any. */
  module?: string;
  /** Caveats the model should know about (no types shipped, compiled module, docs-only signatures, …). */
  notes?: string[];
}

export interface LibExtraction {
  info: LibraryInfo;
  entries: ApiEntry[];
  /** Container whose direct children make up the overview ("" in most cases). */
  rootContainer: string;
}

export interface LibQueryOptions {
  /** Show details for one symbol: "Name" or "Container.member" (suffix match on the full dotted name). */
  symbol?: string;
  /** Case-insensitive substring search over dotted names. */
  query?: string;
  /** Include full docs in the overview/search views (the symbol view always shows them). */
  includeDocs?: boolean;
  /** Cap on listed entries. */
  maxResults?: number;
}
