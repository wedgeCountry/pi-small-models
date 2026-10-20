/**
 * Reads a .NET XML documentation file (the `<Assembly>.xml` that ships next to a DLL) into
 * `ApiEntry`s. There is no compiled metadata involved: every signature is rebuilt from the
 * member's documentation ID, e.g.
 *
 *   M:Newtonsoft.Json.JsonConvert.SerializeObject(System.Object,Newtonsoft.Json.Formatting)
 *
 * which gives the namespace, type, member name, and exact parameter types; parameter names come
 * from `<param name>`. Return types, modifiers and undocumented members are not available.
 */
import type { ApiEntry } from "./types.ts";

export interface XmlDocMember {
  id: string;
  inner: string;
}

const MEMBER_RE = /<member\s+name="([^"]+)"\s*(?:\/>|>([\s\S]*?)<\/member>)/g;

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

export function parseXmlDocMembers(xml: string): XmlDocMember[] {
  const out: XmlDocMember[] = [];
  for (const m of xml.matchAll(MEMBER_RE)) out.push({ id: decodeEntities(m[1]!), inner: m[2] ?? "" });
  return out;
}

/** `<assembly><name>X</name>` of the doc file. */
export function xmlDocAssemblyName(xml: string): string | undefined {
  return /<assembly>\s*<name>([^<]+)<\/name>/.exec(xml)?.[1]?.trim();
}

// ---------------------------------------------------------------------------- doc text

/** Short display form of a cref: "T:A.B.C" → "C", "M:A.B.C.D(System.Int32)" → "C.D". */
function crefShort(cref: string): string {
  const body = cref.replace(/^[A-Z]:/, "").replace(/\(.*$/, "").replace(/`+\d+/g, "");
  const parts = body.split(".");
  const keep = /^[MPFE]:/.test(cref) ? 2 : 1;
  return parts.slice(-keep).join(".").replace(/#ctor$/, "ctor");
}

const PARA = "\u0001";
const CODE_OPEN = "\u0002";
const CODE_CLOSE = "\u0003";

/** Converts inline doc XML to plain text with `code`, keeping paragraphs and code blocks. */
export function docXmlToText(inner: string): string {
  let s = inner;
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/g, (_, code: string) => `${CODE_OPEN}${code.replace(/\n/g, "\u0004")}${CODE_CLOSE}`);
  s = s.replace(/<see\s+langword="([^"]+)"\s*\/>/g, "`$1`");
  s = s.replace(/<see\s+cref="([^"]+)"\s*\/>/g, (_, c: string) => `\`${crefShort(c)}\``);
  s = s.replace(/<see\s+cref="[^"]*"\s*>([\s\S]*?)<\/see>/g, "$1");
  s = s.replace(/<see\s+href="([^"]+)"\s*\/>/g, "$1");
  s = s.replace(/<see\s+href="([^"]+)"\s*>([\s\S]*?)<\/see>/g, "$2 ($1)");
  s = s.replace(/<a\s+href="([^"]+)"\s*>([\s\S]*?)<\/a>/g, "$2 ($1)");
  s = s.replace(/<(?:paramref|typeparamref)\s+name="([^"]+)"\s*\/>/g, "`$1`");
  s = s.replace(/<c>([\s\S]*?)<\/c>/g, "`$1`");
  s = s.replace(/<\/?para\s*\/?>|<br\s*\/?>/g, PARA);
  s = s.replace(/<item>/g, `${PARA}- `).replace(/<\/term>\s*<description>/g, ": ");
  s = s.replace(/<inheritdoc[^>]*\/?>/g, "(Documentation inherited from the base type or interface.)");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t\r\n]+/g, " ");
  s = s.replace(new RegExp(`\\s*${PARA}+\\s*`, "g"), "\n\n");
  s = s.replace(new RegExp(`\\s*${CODE_OPEN}([^${CODE_CLOSE}]*)${CODE_CLOSE}\\s*`, "g"), (_, code: string) => {
    const lines = code.split("\u0004");
    const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length));
    const body = lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join("\n").trim();
    return `\n\n\`\`\`\n${decodeEntities(body)}\n\`\`\`\n\n`;
  });
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

function section(inner: string, tag: string): string | undefined {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`).exec(inner);
  const text = m ? docXmlToText(m[1]!) : "";
  return text || undefined;
}

function named(inner: string, tag: string): { name: string; text: string }[] {
  const out: { name: string; text: string }[] = [];
  const re = new RegExp(`<${tag}\\s+(?:name|cref)="([^"]*)"\\s*(?:\\/>|>([\\s\\S]*?)<\\/${tag}>)`, "g");
  for (const m of inner.matchAll(re)) out.push({ name: decodeEntities(m[1]!), text: docXmlToText(m[2] ?? "") });
  return out;
}

const MAX_SECTION_CHARS = 1500;
const cap = (s: string) => (s.length > MAX_SECTION_CHARS ? `${s.slice(0, MAX_SECTION_CHARS - 1)}…` : s);

/** Full doc text for one member: summary, parameters, returns, exceptions, remarks, example. */
export function formatMemberDocs(inner: string): string | undefined {
  const parts: string[] = [];
  if (/<inheritdoc/.test(inner) && !/<summary/.test(inner)) parts.push("(Documentation inherited from the base type or interface.)");
  const summary = section(inner, "summary");
  if (summary) parts.push(summary);
  const tps = named(inner, "typeparam");
  if (tps.length) parts.push(`Type parameters:\n${tps.map((p) => `  ${p.name}: ${p.text}`).join("\n")}`);
  const ps = named(inner, "param");
  if (ps.length) parts.push(`Parameters:\n${ps.map((p) => `  ${p.name}: ${p.text}`).join("\n")}`);
  const returns = section(inner, "returns");
  if (returns) parts.push(`Returns: ${returns}`);
  const value = section(inner, "value");
  if (value) parts.push(`Value: ${value}`);
  const ex = named(inner, "exception");
  if (ex.length) parts.push(`Exceptions:\n${ex.map((e) => `  ${crefShort(e.name)}: ${e.text}`).join("\n")}`);
  const remarks = section(inner, "remarks");
  if (remarks) parts.push(`Remarks: ${cap(remarks)}`);
  const example = section(inner, "example");
  if (example) parts.push(`Example: ${cap(example)}`);
  const text = parts.join("\n\n").trim();
  return text || undefined;
}

// ---------------------------------------------------------------------------- doc IDs → signatures

const KEYWORDS: Record<string, string> = {
  "System.String": "string",
  "System.Int32": "int",
  "System.Int64": "long",
  "System.Int16": "short",
  "System.Byte": "byte",
  "System.SByte": "sbyte",
  "System.UInt32": "uint",
  "System.UInt64": "ulong",
  "System.UInt16": "ushort",
  "System.Boolean": "bool",
  "System.Char": "char",
  "System.Double": "double",
  "System.Single": "float",
  "System.Decimal": "decimal",
  "System.Object": "object",
  "System.Void": "void",
  "System.IntPtr": "nint",
  "System.UIntPtr": "nuint",
};

const OPERATORS: Record<string, string> = {
  op_Addition: "+", op_Subtraction: "-", op_Multiply: "*", op_Division: "/", op_Modulus: "%",
  op_Equality: "==", op_Inequality: "!=", op_LessThan: "<", op_GreaterThan: ">",
  op_LessThanOrEqual: "<=", op_GreaterThanOrEqual: ">=", op_BitwiseAnd: "&", op_BitwiseOr: "|",
  op_ExclusiveOr: "^", op_LeftShift: "<<", op_RightShift: ">>", op_UnsignedRightShift: ">>>",
  op_UnaryNegation: "-", op_UnaryPlus: "+", op_LogicalNot: "!", op_OnesComplement: "~",
  op_Increment: "++", op_Decrement: "--", op_True: "true", op_False: "false",
};

/** Splits on commas that aren't nested inside {} or []. */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  if (s.length) out.push(s.slice(start));
  return out;
}

interface TypeParamNames {
  type: string[];
  method: string[];
}

/** Renders one doc-ID type ("System.Collections.Generic.List{System.String}[]") as C#. */
export function renderDocIdType(t: string, tp: TypeParamNames = { type: [], method: [] }): string {
  let suffix = "";
  let s = t.trim();
  for (;;) {
    if (s.endsWith("@")) {
      s = s.slice(0, -1); // by-ref handled by the caller
    } else if (s.endsWith("*")) {
      suffix = `*${suffix}`;
      s = s.slice(0, -1);
    } else if (s.endsWith("]")) {
      const open = s.lastIndexOf("[");
      const dims = s.slice(open + 1, -1);
      suffix = `[${",".repeat(Math.max(0, dims.split(",").length - 1))}]${suffix}`;
      s = s.slice(0, open);
    } else break;
  }
  let m: RegExpExecArray | null;
  if ((m = /^``(\d+)$/.exec(s))) return `${tp.method[+m[1]!] ?? `TM${m[1]}`}${suffix}`;
  if ((m = /^`(\d+)$/.exec(s))) return `${tp.type[+m[1]!] ?? `T${m[1]}`}${suffix}`;
  const brace = s.indexOf("{");
  if (brace >= 0 && s.endsWith("}")) {
    const name = s.slice(0, brace);
    const args = splitTopLevel(s.slice(brace + 1, -1)).map((a) => renderDocIdType(a, tp));
    if (name === "System.Nullable" && args.length === 1) return `${args[0]}?${suffix}`;
    if (/^System\.ValueTuple$/.test(name)) return `(${args.join(", ")})${suffix}`;
    return `${shortTypeName(name)}<${args.join(", ")}>${suffix}`;
  }
  return `${KEYWORDS[s] ?? shortTypeName(s)}${suffix}`;
}

function shortTypeName(full: string): string {
  return (full.split(".").pop() ?? full).replace(/`+\d+$/, "");
}

/** "List`1" → { name: "List", arity: 1 }. */
function splitArity(segment: string): { name: string; arity: number } {
  const m = /^(.*?)`+(\d+)$/.exec(segment);
  return m ? { name: m[1]!, arity: +m[2]! } : { name: segment, arity: 0 };
}

function generic(names: string[]): string {
  return names.length ? `<${names.join(", ")}>` : "";
}

interface ParsedId {
  prefix: string;
  /** Dotted path without params; segments still carry `N arity suffixes. */
  segments: string[];
  params?: string[];
  returnType?: string;
}

export function parseDocId(id: string): ParsedId | undefined {
  const m = /^([TMPFEN]):(.+)$/s.exec(id);
  if (!m) return undefined;
  let rest = m[2]!;
  let returnType: string | undefined;
  let params: string[] | undefined;
  const paren = rest.indexOf("(");
  if (paren >= 0) {
    const close = rest.lastIndexOf(")");
    params = splitTopLevel(rest.slice(paren + 1, close));
    const tail = rest.slice(close + 1);
    if (tail.startsWith("~")) returnType = tail.slice(1);
    rest = rest.slice(0, paren);
  } else if (rest.includes("~")) {
    [rest, returnType] = rest.split("~") as [string, string];
  }
  return { prefix: m[1]!, segments: rest.split("."), params, returnType };
}

/**
 * Builds `ApiEntry`s for every documented member. Types get their namespace (or enclosing type)
 * as container; members get their type's full name (generic arity stripped).
 */
export function xmlDocsToEntries(members: XmlDocMember[], source?: string): { entries: ApiEntry[]; namespaces: string[] } {
  const parsed = members.map((m) => ({ m, p: parseDocId(m.id) })).filter((x): x is { m: XmlDocMember; p: ParsedId } => !!x.p);

  // Type paths as written in the IDs ("Ns.List`1"), to tell namespaces from enclosing types.
  const typePaths = new Set(parsed.filter((x) => x.p.prefix === "T").map((x) => x.p.segments.join(".")));
  const typeParamsOf = new Map<string, string[]>();
  for (const { m, p } of parsed) {
    if (p.prefix !== "T") continue;
    const own = named(m.inner, "typeparam").map((t) => t.name);
    typeParamsOf.set(p.segments.join("."), own);
  }
  const stripArity = (segs: string[]) => segs.map((s) => splitArity(s).name).join(".");

  /** Longest proper prefix of `segs` that is a documented type, else undefined. */
  const enclosingType = (segs: string[]): string[] | undefined => {
    for (let i = segs.length - 1; i > 0; i--) if (typePaths.has(segs.slice(0, i).join("."))) return segs.slice(0, i);
    return undefined;
  };
  const namespaceOf = (typeSegs: string[]): string => {
    let segs = typeSegs;
    for (let outer = enclosingType(segs); outer; outer = enclosingType(segs)) segs = outer;
    return segs.slice(0, -1).join(".");
  };
  /** All generic type parameter names in scope for a type path (outer types first). */
  const typeParamsFor = (typeSegs: string[]): string[] => {
    const names: string[] = [];
    for (let i = 1; i <= typeSegs.length; i++) {
      const pathStr = typeSegs.slice(0, i).join(".");
      const { arity } = splitArity(typeSegs[i - 1]!);
      if (!arity) continue;
      const own = typeParamsOf.get(pathStr) ?? [];
      for (let k = 0; k < arity; k++) names.push(own[k] ?? (arity === 1 ? "T" : `T${k + 1}`));
    }
    return names;
  };

  // Member kinds per type, to name the type's kind (class / interface / enum / delegate).
  const memberKinds = new Map<string, Set<string>>();
  for (const { p } of parsed) {
    if (p.prefix === "T" || p.prefix === "N") continue;
    const owner = (enclosingType(p.segments) ?? p.segments.slice(0, -1)).join(".");
    const set = memberKinds.get(owner) ?? new Set<string>();
    set.add(p.segments[p.segments.length - 1] === "#ctor" ? "ctor" : p.prefix);
    memberKinds.set(owner, set);
  }

  const entries: ApiEntry[] = [];
  const namespaces = new Set<string>();
  const undocumentedOwners = new Map<string, string[]>();
  for (const { m, p } of parsed) {
    if (p.prefix === "N") continue;
    const docs = formatMemberDocs(m.inner);
    const last = p.segments[p.segments.length - 1]!;

    if (p.prefix === "T") {
      const outer = enclosingType(p.segments);
      const ns = namespaceOf(p.segments);
      namespaces.add(ns);
      const { name, arity } = splitArity(last);
      const own = typeParamsOf.get(p.segments.join(".")) ?? [];
      const tps = Array.from({ length: arity }, (_, k) => own[k] ?? (arity === 1 ? "T" : `T${k + 1}`));
      const kinds = memberKinds.get(p.segments.join(".")) ?? new Set<string>();
      let kind = "type";
      if (/<param\s|<returns>/.test(m.inner)) kind = "delegate";
      else if (kinds.size && [...kinds].every((k) => k === "F")) kind = "enum";
      else if (/^I[A-Z]/.test(name) && !kinds.has("ctor") && !kinds.has("F")) kind = "interface";
      else if (kinds.has("ctor")) kind = "class";
      const params = kind === "delegate" ? `(${named(m.inner, "param").map((x) => x.name).join(", ")})` : "";
      entries.push({
        kind,
        name,
        container: outer ? stripArity(outer) : ns,
        signature: `${kind} ${name}${generic(tps)}${params}`,
        docs,
        source,
      });
      continue;
    }

    const ownerSegs = enclosingType(p.segments) ?? p.segments.slice(0, -1);
    const owner = stripArity(ownerSegs);
    const ownerName = splitArity(ownerSegs[ownerSegs.length - 1] ?? "").name;
    const typeTps = typeParamsFor(ownerSegs);
    const { name: rawName, arity: methodArity } = splitArity(last);
    const methodTpNames = named(m.inner, "typeparam").map((t) => t.name);
    const methodTps = Array.from({ length: methodArity }, (_, k) => methodTpNames[k] ?? (methodArity === 1 ? "T" : `T${k + 1}`));
    const tp: TypeParamNames = { type: typeTps, method: methodTps };
    const paramNames = named(m.inner, "param").map((x) => x.name);
    const paramList = (p.params ?? []).map((t, i) => {
      const ref = t.trim().endsWith("@") ? "ref " : "";
      const rendered = `${ref}${renderDocIdType(t, tp)}`;
      return paramNames.length === (p.params ?? []).length ? `${rendered} ${paramNames[i]}` : rendered;
    });
    const memberName = rawName.replace(/#/g, "."); // explicit interface implementations

    let kind: string;
    let name = memberName;
    let signature: string;
    switch (p.prefix) {
      case "M":
        if (rawName === "#ctor") {
          kind = "constructor";
          name = "constructor";
          signature = `new ${ownerName}(${paramList.join(", ")})`;
        } else if (rawName === "#cctor") {
          continue;
        } else if (rawName === "op_Implicit" || rawName === "op_Explicit") {
          kind = "operator";
          const ret = p.returnType ? renderDocIdType(p.returnType, tp) : "?";
          signature = `${rawName === "op_Implicit" ? "implicit" : "explicit"} operator ${ret}(${paramList.join(", ")})`;
        } else if (OPERATORS[rawName]) {
          kind = "operator";
          signature = `operator ${OPERATORS[rawName]}(${paramList.join(", ")})`;
        } else {
          kind = "method";
          signature = `${memberName}${generic(methodTps)}(${paramList.join(", ")})`;
        }
        break;
      case "P":
        kind = "property";
        signature = p.params?.length ? `this[${paramList.join(", ")}]` : `property ${memberName}`;
        if (p.params?.length) name = rawName; // indexers: usually "Item"
        break;
      case "F":
        kind = "field";
        signature = `field ${memberName}`;
        break;
      case "E":
        kind = "event";
        signature = `event ${memberName}`;
        break;
      default:
        continue;
    }
    entries.push({ kind, name, container: owner, signature, docs, source });
    if (!typePaths.has(ownerSegs.join(".")) && ownerSegs.length > 1) undocumentedOwners.set(ownerSegs.join("."), ownerSegs);
  }

  // Members whose type itself has no <member name="T:…"> entry: add a placeholder type so the
  // namespace overview still lists it.
  for (const segs of undocumentedOwners.values()) {
    const ns = namespaceOf(segs);
    namespaces.add(ns);
    const { name, arity } = splitArity(segs[segs.length - 1]!);
    const outer = enclosingType(segs);
    entries.push({
      kind: "type",
      name,
      container: outer ? stripArity(outer) : ns,
      signature: `type ${name}${generic(arity ? typeParamsFor(segs).slice(-arity) : [])} (not documented itself)`,
      source,
    });
  }
  return { entries, namespaces: [...namespaces].sort() };
}
