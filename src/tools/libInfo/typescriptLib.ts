import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { isLibraryPathSafe } from "../../sandbox.ts";
import type { ApiEntry, LibExtraction, LibraryInfo } from "./types.ts";
import { ancestors, displayPath, isDirectory, isFile, realpathOr } from "./paths.ts";

/** npm package names: optional @scope/, then a name. No path traversal possible. */
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;
/** Hard cap on extracted entries, so a giant namespace re-export can't run away. */
const MAX_ENTRIES = 20000;
const MAX_NAMESPACE_DEPTH = 4;
const MAX_SIGNATURE_CHARS = 2000;

export interface TsLibOptions {
  /** Subpath export: "zod/v4", "./v4" or "v4". */
  module?: string;
  signal?: AbortSignal;
}

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  exports?: unknown;
  types?: string;
  typings?: string;
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Existing `node_modules` directories on Node's lookup chain from `root` upwards. */
function nodeModulesChain(root: string): string[] {
  return ancestors(root)
    .map((d) => path.join(d, "node_modules"))
    .filter(isDirectory);
}

/** Finds `<node_modules>/<pkg>` the way Node's lookup does (nearest first). */
function findPackageDir(root: string, pkg: string): string | undefined {
  for (const nm of nodeModulesChain(root)) {
    const dir = path.join(nm, pkg);
    if (isFile(path.join(dir, "package.json"))) return dir;
  }
  return undefined;
}

function typesPackageName(pkg: string): string {
  return pkg.startsWith("@") ? `@types/${pkg.slice(1).replace("/", "__")}` : `@types/${pkg}`;
}

/** "zod/v4" | "./v4" | "v4" → "zod/v4". */
export function moduleSpecifier(pkg: string, module: string | undefined): string {
  if (!module || module === "." || module === pkg) return pkg;
  let sub = module.startsWith(`${pkg}/`) ? module.slice(pkg.length + 1) : module.replace(/^\.?\//, "");
  sub = sub.replace(/\/+$/, "");
  if (sub.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) {
    throw new Error(`Invalid module "${module}": use a subpath like "${pkg}/sub"`);
  }
  return `${pkg}/${sub}`;
}

/** Subpath entry points from package.json "exports", e.g. ["zod", "zod/v4"]. */
function listModules(pkg: string, pj: PackageJson): string[] {
  const exp = pj.exports;
  if (!exp || typeof exp !== "object" || Array.isArray(exp)) return [pkg];
  const keys = Object.keys(exp as object);
  if (!keys.some((k) => k.startsWith("."))) return [pkg]; // conditions-only object = single entry point
  return keys
    .filter((k) => k.startsWith(".") && k !== "./package.json" && !k.endsWith(".json"))
    .map((k) => (k === "." ? pkg : `${pkg}/${k.replace(/^\.\//, "")}`));
}

function cleanJsDoc(raw: string): string {
  return raw
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((l) => l.replace(/^\s*\* ?/, "").trimEnd())
    .join("\n")
    .trim();
}

function compact(text: string): string {
  let s = text
    .replace(/\s+/g, " ")
    .replace(/([(<[])\s+/g, "$1")
    .replace(/,?\s+([)>\]])/g, "$1")
    .trim();
  s = s.replace(/^(export\s+)?(default\s+)?(declare\s+)?/, "");
  s = s.replace(/[;{,]\s*$/, "").trim();
  return s.length > MAX_SIGNATURE_CHARS ? `${s.slice(0, MAX_SIGNATURE_CHARS - 1)}…` : s;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

class Extractor {
  readonly entries: ApiEntry[] = [];
  private readonly seen = new Set<ts.Node>();

  constructor(
    private readonly checker: ts.TypeChecker,
    private readonly root: string,
    private readonly entryFile: string
  ) {}

  private push(entry: ApiEntry): void {
    if (this.entries.length < MAX_ENTRIES) this.entries.push(entry);
  }

  private docs(node: ts.Node): string | undefined {
    const parts: string[] = [];
    for (const d of ts.getJSDocCommentsAndTags(node)) {
      if (d.kind === ts.SyntaxKind.JSDoc) parts.push(cleanJsDoc(d.getText()));
    }
    const text = [...new Set(parts)].filter(Boolean).join("\n\n");
    return text || undefined;
  }

  private where(node: ts.Node): { source: string; line: number } {
    const sf = node.getSourceFile();
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    return { source: displayPath(this.root, sf.fileName), line };
  }

  /** Source text of `node` up to (not including) `endPos`, compacted. */
  private header(node: ts.Node, endPos?: number): string {
    const sf = node.getSourceFile();
    return compact(sf.text.slice(node.getStart(sf), endPos ?? node.getEnd()));
  }

  private memberName(m: ts.Node): string | undefined {
    if (ts.isConstructorDeclaration(m) || ts.isConstructSignatureDeclaration(m)) return "constructor";
    if (ts.isCallSignatureDeclaration(m)) return "(call)";
    if (ts.isIndexSignatureDeclaration(m)) return "[index]";
    const name = (m as ts.NamedDeclaration).name;
    if (!name) return undefined;
    if (ts.isPrivateIdentifier(name)) return undefined;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
    return name.getText();
  }

  private memberKind(m: ts.Node): string {
    if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) return "method";
    if (ts.isConstructorDeclaration(m) || ts.isConstructSignatureDeclaration(m)) return "constructor";
    if (ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) return "accessor";
    if (ts.isEnumMember(m)) return "enum member";
    if (ts.isCallSignatureDeclaration(m)) return "call signature";
    if (ts.isIndexSignatureDeclaration(m)) return "index signature";
    return "property";
  }

  private addMembers(members: ts.NodeArray<ts.Node>, container: string): void {
    for (const m of members) {
      if (hasModifier(m, ts.SyntaxKind.PrivateKeyword)) continue;
      const name = this.memberName(m);
      if (name === undefined) continue;
      const body = (m as ts.FunctionLikeDeclarationBase).body;
      const init = (m as ts.PropertyDeclaration).initializer;
      const end = body ? body.getStart() : init && !ts.isEnumMember(m) ? init.getStart() - 1 : undefined;
      let signature = this.header(m, end);
      if (init && !ts.isEnumMember(m)) signature = signature.replace(/\s*=\s*$/, "");
      this.push({ kind: this.memberKind(m), name, container, signature, docs: this.docs(m), ...this.where(m) });
    }
  }

  /** Adds the entry (and members) for one declaration of an exported symbol. */
  private addDeclaration(decl: ts.Declaration, name: string, container: string, reexportedFrom: string | undefined, depth: number): void {
    if (this.seen.has(decl) && depth > 0) return;
    this.seen.add(decl);
    const base = { name, container, docs: this.docs(decl), reexportedFrom, ...this.where(decl) };
    const qualified = container ? `${container}.${name}` : name;

    if (ts.isClassDeclaration(decl) || ts.isClassExpression(decl)) {
      this.push({ ...base, kind: "class", signature: this.header(decl, decl.members.pos - 1) });
      this.addMembers(decl.members, qualified);
    } else if (ts.isInterfaceDeclaration(decl)) {
      this.push({ ...base, kind: "interface", signature: this.header(decl, decl.members.pos - 1) });
      this.addMembers(decl.members, qualified);
    } else if (ts.isEnumDeclaration(decl)) {
      this.push({ ...base, kind: "enum", signature: this.header(decl, decl.members.pos - 1) });
      this.addMembers(decl.members, qualified);
    } else if (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl)) {
      let signature = this.header(decl, decl.body?.getStart());
      if (!decl.getSourceFile().isDeclarationFile) {
        // JS/TS source: let the checker fill in inferred parameter and return types.
        const sig = this.checker.getSignatureFromDeclaration(decl);
        if (sig) signature = compact(`${decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? "async " : ""}function ${name}${this.checker.signatureToString(sig, undefined, ts.TypeFormatFlags.NoTruncation)}`);
      }
      this.push({ ...base, kind: "function", signature });
    } else if (ts.isTypeAliasDeclaration(decl)) {
      if (ts.isTypeLiteralNode(decl.type)) {
        this.push({ ...base, kind: "type", signature: `${this.header(decl, decl.type.getStart())} { … }` });
        this.addMembers(decl.type.members, qualified);
      } else {
        this.push({ ...base, kind: "type", signature: this.header(decl) });
        // `type Options = OptionsInternal` — show the members of what it points at.
        if (ts.isTypeReferenceNode(decl.type)) this.addReferencedMembers(decl.type.typeName, qualified);
      }
    } else if (ts.isVariableDeclaration(decl)) {
      const list = decl.parent;
      const keyword = ts.isVariableDeclarationList(list)
        ? list.flags & ts.NodeFlags.Const
          ? "const"
          : list.flags & ts.NodeFlags.Let
            ? "let"
            : "var"
        : "const";
      let text: string;
      if (decl.type) {
        text = `${keyword} ${this.header(decl, decl.initializer ? decl.initializer.getStart() - 1 : undefined).replace(/\s*=\s*$/, "")}`;
      } else {
        // JS / untyped: ask the checker for the inferred type.
        const type = this.checker.typeToString(this.checker.getTypeAtLocation(decl.name), undefined, ts.TypeFormatFlags.NoTruncation);
        text = compact(`${keyword} ${decl.name.getText()}: ${type}`);
      }
      this.push({ ...base, kind: keyword === "const" ? "const" : "variable", signature: text });
      if (decl.type && ts.isTypeLiteralNode(decl.type)) this.addMembers(decl.type.members, qualified);
      // `declare const micromatch: Micromatch` — the interface holds the actual API.
      else if (decl.type && ts.isTypeReferenceNode(decl.type)) this.addReferencedMembers(decl.type.typeName, qualified);
    } else if (ts.isModuleDeclaration(decl)) {
      this.push({ ...base, kind: "namespace", signature: `namespace ${qualified}` });
      const sym = this.checker.getSymbolAtLocation(decl.name);
      if (sym && depth < MAX_NAMESPACE_DEPTH) this.addExports(this.checker.getExportsOfModule(sym), qualified, depth + 1);
    } else if (ts.isSourceFile(decl)) {
      // `export * as ns from "./x"` — a whole module re-exported under one name.
      const rel = displayPath(this.root, decl.fileName);
      this.push({ ...base, kind: "namespace", signature: `namespace ${name} (module ${rel})`, source: rel, line: 1 });
      const sym = this.checker.getSymbolAtLocation(decl);
      if (sym && depth < MAX_NAMESPACE_DEPTH) this.addExports(this.checker.getExportsOfModule(sym), qualified, depth + 1);
    } else if (ts.isExportAssignment(decl)) {
      this.push({ ...base, kind: "default", signature: this.header(decl) });
    } else if (ts.isFunctionExpression(decl) || ts.isArrowFunction(decl)) {
      this.push({ ...base, kind: "function", signature: `${name}${this.header(decl, decl.body.getStart()).replace(/^(async\s+)?function\s*\w*/, "$1")}` });
    } else if (ts.isPropertyAssignment(decl) || ts.isShorthandPropertyAssignment(decl) || ts.isBinaryExpression(decl) || ts.isPropertyAccessExpression(decl)) {
      // CommonJS `module.exports.x = …` / `exports.x = …` in plain JS packages.
      const type = this.checker.typeToString(this.checker.getTypeAtLocation(decl), undefined, ts.TypeFormatFlags.NoTruncation);
      this.push({ ...base, kind: "export", signature: compact(`${name}: ${type}`) });
    } else {
      this.push({ ...base, kind: ts.SyntaxKind[decl.kind] ?? "declaration", signature: this.header(decl) });
    }
  }

  /** Members of the interface / class / object type alias that `typeName` refers to. */
  private addReferencedMembers(typeName: ts.EntityName, container: string): void {
    let sym = this.checker.getSymbolAtLocation(typeName);
    if (!sym) return;
    if (sym.flags & ts.SymbolFlags.Alias) {
      try {
        sym = this.checker.getAliasedSymbol(sym);
      } catch {
        return;
      }
    }
    for (const d of sym.declarations ?? []) {
      if (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) this.addMembers(d.members, container);
      else if (ts.isTypeAliasDeclaration(d) && ts.isTypeLiteralNode(d.type)) this.addMembers(d.type.members, container);
    }
  }

  addExports(symbols: readonly ts.Symbol[], container: string, depth: number): void {
    for (const exp of symbols) {
      if (this.entries.length >= MAX_ENTRIES) return;
      const name = exp.getName();
      let target = exp;
      let reexportedFrom: string | undefined;
      if (exp.flags & ts.SymbolFlags.Alias) {
        try {
          target = this.checker.getAliasedSymbol(exp);
        } catch {
          continue;
        }
        const spec = exp.declarations?.[0];
        const from =
          spec && ts.isExportSpecifier(spec) && spec.parent.parent.moduleSpecifier && ts.isStringLiteral(spec.parent.parent.moduleSpecifier)
            ? spec.parent.parent.moduleSpecifier.text
            : undefined;
        reexportedFrom = from;
      }
      const decls = target.declarations ?? [];
      if (decls.length === 0) continue;
      for (const decl of decls) this.addDeclaration(decl, name, container, reexportedFrom, depth);
    }
  }

  addExportEquals(exportEquals: ts.Symbol): void {
    let target = exportEquals;
    if (target.flags & ts.SymbolFlags.Alias) {
      try {
        target = this.checker.getAliasedSymbol(target);
      } catch {
        return;
      }
    }
    for (const decl of target.declarations ?? []) {
      // A merged `namespace x` was already flattened into the top-level exports.
      if (ts.isModuleDeclaration(decl)) continue;
      this.addDeclaration(decl, target.getName(), "", undefined, 0);
    }
  }

  /** For a script-style .d.ts (no imports/exports, only globals). */
  addGlobals(sf: ts.SourceFile): void {
    for (const stmt of sf.statements) {
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) this.addDeclaration(d, d.name.getText(), "", undefined, 0);
      } else if (
        (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt) || ts.isModuleDeclaration(stmt)) &&
        stmt.name
      ) {
        this.addDeclaration(stmt, stmt.name.getText(), "", undefined, 0);
      }
    }
  }
}

/**
 * Locates an installed npm package (Node's `node_modules` lookup from `root` upwards), resolves
 * its type entry point for `module` with TypeScript's own module resolution (package.json
 * `exports` "types" conditions, `typesVersions`, `types`/`typings`, `@types/*` fallback, and plain
 * `.js` when no types ship at all), then lists its exports with the TypeScript checker — which
 * follows `export *` / `export { x } from` chains, merges overloads and reads JSDoc.
 *
 * Every file the compiler opens must pass `isLibraryPathSafe` against the project root, the
 * `node_modules` lookup chain and TypeScript's own lib directory; anything else looks absent.
 */
export async function extractTsLibrary(root: string, pkg: string, opts: TsLibOptions = {}): Promise<LibExtraction> {
  opts.signal?.throwIfAborted();
  pkg = pkg.trim();
  if (!NPM_NAME.test(pkg)) throw new Error(`"${pkg}" is not a valid npm package name`);
  const specifier = moduleSpecifier(pkg, opts.module);

  const absRoot = path.resolve(root);
  const pkgDir = findPackageDir(absRoot, pkg);
  const typesDir = findPackageDir(absRoot, typesPackageName(pkg));
  if (!pkgDir && !typesDir) {
    throw new Error(`Package "${pkg}" is not installed (no node_modules/${pkg} found from the project root upwards). Use npm_list to see installed packages.`);
  }
  const pj = (pkgDir && readJson<PackageJson>(path.join(pkgDir, "package.json"))) || {};

  const baseOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    maxNodeModuleJsDepth: 0,
  };
  const libDir = path.dirname(ts.getDefaultLibFilePath(baseOptions));
  const libRoots = [absRoot, ...nodeModulesChain(absRoot), libDir, ...[pkgDir, typesDir].filter((d): d is string => !!d).map(realpathOr)];
  const allowed = (f: string) => isLibraryPathSafe(libRoots, f);

  const makeHost = (options: ts.CompilerOptions): ts.CompilerHost => {
    const host = ts.createCompilerHost(options, true);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
      allowed(fileName) ? getSourceFile(fileName, languageVersion, onError, shouldCreate) : undefined;
    host.fileExists = (f) => allowed(f) && ts.sys.fileExists(f);
    host.readFile = (f) => (allowed(f) ? ts.sys.readFile(f) : undefined);
    host.directoryExists = (d) => allowed(d) && ts.sys.directoryExists(d);
    return host;
  };

  // Bundler resolution reads "exports" with the "types"/"import" conditions; NodeNext covers
  // "require"-only exports; Node10 covers old-style main/types/typesVersions packages.
  const containing = path.join(absRoot, "__pi_ts_lib__.ts");
  const strategies: ts.CompilerOptions[] = [
    { ...baseOptions, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler },
    { ...baseOptions, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext },
    { ...baseOptions, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10 },
  ];
  let resolved: ts.ResolvedModuleFull | undefined;
  let options = strategies[0]!;
  for (const candidate of strategies) {
    const r = ts.resolveModuleName(specifier, containing, candidate, makeHost(candidate));
    if (r.resolvedModule) {
      resolved = r.resolvedModule;
      options = candidate;
      break;
    }
  }
  const modules = listModules(pkg, pj);
  if (!resolved) {
    const hint = modules.length > 1 ? ` Available modules: ${modules.join(", ")}.` : "";
    throw new Error(`Could not resolve "${specifier}" from the project root.${hint}`);
  }
  opts.signal?.throwIfAborted();

  const entryFile = resolved.resolvedFileName;
  // Signatures of .d.ts packages are taken from source text, so TypeScript's default lib files
  // (~1s to parse) aren't needed; plain-JS packages need them for inferred types.
  if (resolved.extension === ts.Extension.Dts || resolved.extension === ts.Extension.Dmts || resolved.extension === ts.Extension.Dcts) {
    options = { ...options, noLib: true };
  }
  const program = ts.createProgram({ rootNames: [entryFile], options, host: makeHost(options) });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(entryFile);
  if (!sf) throw new Error(`Could not read ${displayPath(absRoot, entryFile)}`);
  opts.signal?.throwIfAborted();

  const extractor = new Extractor(checker, absRoot, entryFile);
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  const notes: string[] = [];
  if (moduleSymbol) {
    extractor.addExports(checker.getExportsOfModule(moduleSymbol), "", 0);
    // `export = x` (CommonJS-style .d.ts): the exports above are x's namespace members; also
    // show x itself (e.g. the callable function), under its own name.
    const exportEquals = moduleSymbol.exports?.get(ts.InternalSymbolName.ExportEquals);
    if (exportEquals) {
      extractor.addExportEquals(exportEquals);
      notes.push(`CommonJS module (\`export =\`): import it as \`import x = require("${specifier}")\`, or as a default import with esModuleInterop.`);
    }
  } else {
    extractor.addGlobals(sf);
    notes.push("This entry point declares globals only (no ES module exports).");
  }

  const ext = resolved.extension;
  if (ext === ts.Extension.Js || ext === ts.Extension.Mjs || ext === ts.Extension.Cjs || ext === ts.Extension.Jsx) {
    notes.push(`"${pkg}" ships no type declarations, so signatures come from its JavaScript and have no types. Installing ${typesPackageName(pkg)} (if it exists) would give typed signatures.`);
  }
  const typesPkg = typesDir && realpathOr(entryFile).startsWith(realpathOr(typesDir) + path.sep);
  if (typesPkg) {
    const tpj = readJson<PackageJson>(path.join(typesDir!, "package.json"));
    notes.push(`Types come from ${typesPackageName(pkg)}${tpj?.version ? ` ${tpj.version}` : ""}${pkgDir ? "" : `, but "${pkg}" itself is not installed`}.`);
  }
  if (extractor.entries.length >= MAX_ENTRIES) notes.push(`Only the first ${MAX_ENTRIES} declarations were read; narrow with module=.`);

  const deps = [
    ...Object.entries(pj.dependencies ?? {}).map(([n, v]) => `${n} ${v}`),
    ...Object.entries(pj.peerDependencies ?? {}).map(([n, v]) => `${n} ${v} (peer)`),
  ];
  const info: LibraryInfo = {
    ecosystem: "npm",
    name: pj.name ?? pkg,
    version: pj.version,
    location: pkgDir ? displayPath(absRoot, pkgDir) : undefined,
    apiSource: [displayPath(absRoot, entryFile)],
    summary: pj.description,
    dependencies: deps.length ? deps : undefined,
    modules: modules.length > 1 ? modules : undefined,
    module: specifier !== pkg ? specifier : undefined,
    notes: notes.length ? notes : undefined,
  };
  return { info, entries: extractor.entries, rootContainer: "" };
}
