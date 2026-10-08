"""Helper for the py_lib / py_list tools of pi-small-models.

Run as:  python -I py_libinfo.py '<json args>'   and prints one JSON object.

It never imports the packages it describes: module files are located with
importlib.machinery.PathFinder (which only searches sys.path directories) and
read with `ast`, so no third-party code runs. Only .py/.pyi files under a
sys.path directory are ever opened. Standard library only; Python 3.9+.
"""

import ast
import importlib.machinery
import json
import os
import re
import sys

try:
    import importlib.metadata as md
except ImportError:  # pragma: no cover - Python < 3.8
    md = None

MAX_ENTRIES = 20000
MAX_VALUE_CHARS = 80
MAX_REEXPORT_DEPTH = 6
MAX_MODULES = 300
SKIP_SUBMODULES = {"tests", "test", "testing", "__pycache__", "conftest", "__main__"}


def fail(message):
    print(json.dumps({"error": message}))
    sys.exit(0)


ARGS = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
for extra in reversed(ARGS.get("extraSysPath") or []):  # tests only
    sys.path.insert(0, extra)

if sys.version_info < (3, 9):
    fail("py_lib needs Python 3.9 or newer (found %d.%d)" % sys.version_info[:2])


def sys_path_dirs():
    out = []
    for p in sys.path:
        if p and os.path.isdir(p):
            rp = os.path.realpath(p)
            if rp not in out:
                out.append(rp)
    return out


ROOTS = sys_path_dirs()


def allowed(path):
    rp = os.path.realpath(path)
    if not (rp.endswith(".py") or rp.endswith(".pyi")):
        return False
    return any(rp == r or rp.startswith(r + os.sep) for r in ROOTS)


def env_info():
    return {
        "python": sys.executable,
        "version": "%d.%d.%d" % sys.version_info[:3],
        "paths": ROOTS,
        "sitePackages": [p for p in ROOTS if os.path.basename(p) in ("site-packages", "dist-packages")],
    }


# ----------------------------------------------------------------------------- metadata


def norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def all_distributions():
    seen = {}
    if md is None:
        return []
    for dist in md.distributions():
        try:
            name = dist.metadata["Name"]
        except Exception:
            continue
        if not name or norm(name) in seen:
            continue
        seen[norm(name)] = dist
    return sorted(seen.values(), key=lambda d: norm(d.metadata["Name"]))


def find_distribution(name):
    if md is None:
        return None
    try:
        return md.distribution(name)
    except md.PackageNotFoundError:
        pass
    for dist in all_distributions():
        if norm(dist.metadata["Name"]) == norm(name):
            return dist
    try:
        mapping = md.packages_distributions()
    except Exception:
        mapping = {}
    for key in (name, name.split(".")[0]):
        for dname in mapping.get(key, []):
            try:
                return md.distribution(dname)
            except md.PackageNotFoundError:
                continue
    return None


def top_level_modules(dist):
    try:
        text = dist.read_text("top_level.txt")
    except Exception:
        text = None
    if text:
        names = [l.strip() for l in text.splitlines() if l.strip()]
        if names:
            return names
    names = []
    for f in dist.files or []:
        parts = f.parts
        if not parts or parts[0].endswith((".dist-info", ".egg-info", ".data")) or parts[0] in ("..", "__pycache__", "bin"):
            continue
        if len(parts) == 1:
            base = parts[0]
            for suffix in (".pyi", ".py"):
                if base.endswith(suffix):
                    names.append(base[: -len(suffix)])
            if base.endswith((".so", ".pyd")):
                names.append(base.split(".")[0])
        elif parts[-1] in ("__init__.py", "__init__.pyi"):
            names.append(parts[0])
    out = []
    for n in names:
        n = n[: -len("-stubs")] if n.endswith("-stubs") else n
        if n not in out and n.isidentifier():
            out.append(n)
    return out


def requirements(dist):
    reqs, optional = [], 0
    for r in dist.requires or []:
        if "extra ==" in r.replace(" ", " "):
            optional += 1
            continue
        reqs.append(r)
    return reqs, optional


def dist_summary(dist):
    m = dist.metadata
    return {
        "name": m["Name"],
        "version": dist.version,
        "summary": m.get("Summary") or "",
    }


def required_by(name):
    target = norm(name)
    out = []
    for dist in all_distributions():
        for r in dist.requires or []:
            m = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)", r)
            if m and norm(m.group(1)) == target and "extra ==" not in r:
                out.append(dist.metadata["Name"])
                break
    return out


def cmd_list():
    filt = (ARGS.get("filter") or "").strip()
    dists = all_distributions()
    rows = [dist_summary(d) for d in dists]
    if filt:
        rows = [r for r in rows if norm(filt) in norm(r["name"]) or filt.lower() in r["name"].lower()]
    result = {"env": env_info(), "packages": rows}
    exact = [d for d in dists if filt and norm(d.metadata["Name"]) == norm(filt)]
    if exact:
        d = exact[0]
        reqs, optional = requirements(d)
        meta = d.metadata
        urls = [u for u in (meta.get_all("Project-URL") or [])][:5]
        if meta.get("Home-page"):
            urls.insert(0, "Homepage, " + meta.get("Home-page"))
        result["detail"] = dict(
            dist_summary(d),
            requires=reqs,
            optionalRequires=optional,
            requiredBy=required_by(d.metadata["Name"]),
            topLevel=top_level_modules(d),
            requiresPython=meta.get("Requires-Python") or "",
            urls=urls,
        )
    return result


# ----------------------------------------------------------------------------- locating


def find_spec(modname):
    parts = modname.split(".")
    try:
        spec = importlib.machinery.PathFinder.find_spec(parts[0])
        for i in range(1, len(parts)):
            if spec is None or not spec.submodule_search_locations:
                return None
            spec = importlib.machinery.PathFinder.find_spec(".".join(parts[: i + 1]), list(spec.submodule_search_locations))
        return spec
    except (ImportError, ValueError):
        return None


def stubs_package_dir(top):
    for root in ROOTS:
        cand = os.path.join(root, top + "-stubs")
        if os.path.isdir(cand):
            return cand
    return None


class Located:
    def __init__(self, modname):
        self.modname = modname
        self.file = None  # .py or .pyi to parse
        self.compiled = None  # .so/.pyd with no source
        self.is_package = False
        self.package_dirs = []
        self.from_stubs = None  # "inline" | "stubs-package"
        self.builtin = False


def locate(modname):
    loc = Located(modname)
    top = modname.split(".")[0]
    stubs = stubs_package_dir(top)
    if stubs:
        rel = modname.split(".")[1:]
        base = os.path.join(stubs, *rel)
        for cand, pkg in ((os.path.join(base, "__init__.pyi"), True), (base + ".pyi", False)):
            if os.path.isfile(cand) and allowed(cand):
                loc.file, loc.is_package, loc.from_stubs = cand, pkg, "stubs-package"
                loc.package_dirs = [os.path.dirname(cand)] if pkg else []
                break

    spec = find_spec(modname)
    if spec is None and loc.file is None:
        if modname in sys.builtin_module_names:
            loc.builtin = True
            return loc
        return None
    if spec is not None:
        if spec.submodule_search_locations:
            loc.is_package = True
            if not loc.package_dirs:
                loc.package_dirs = [d for d in spec.submodule_search_locations if os.path.isdir(d)]
        if loc.file is None:
            origin = spec.origin if spec.has_location else None
            if origin and origin.endswith(".py"):
                pyi = origin[:-3] + ".pyi"
                if os.path.isfile(pyi) and allowed(pyi):
                    loc.file, loc.from_stubs = pyi, "inline"
                elif allowed(origin):
                    loc.file = origin
            elif origin and origin.endswith(".pyi") and allowed(origin):
                loc.file, loc.from_stubs = origin, "inline"
            elif origin and origin.endswith((".so", ".pyd")):
                stem = os.path.join(os.path.dirname(origin), os.path.basename(origin).split(".")[0])
                if os.path.isfile(stem + ".pyi") and allowed(stem + ".pyi"):
                    loc.file, loc.from_stubs = stem + ".pyi", "inline"
                else:
                    loc.compiled = origin
            elif origin in ("built-in", "frozen"):
                loc.builtin = True
    return loc


def submodules(loc, include_private):
    out = []
    for d in loc.package_dirs:
        try:
            names = sorted(os.listdir(d))
        except OSError:
            continue
        for n in names:
            full = os.path.join(d, n)
            if os.path.isdir(full):
                if (os.path.isfile(os.path.join(full, "__init__.py")) or os.path.isfile(os.path.join(full, "__init__.pyi"))) and n.isidentifier():
                    mod = n
                else:
                    continue
            else:
                mod = n.split(".")[0]
                if not n.endswith((".py", ".pyi", ".so", ".pyd")) or mod == "__init__" or not mod.isidentifier():
                    continue
            if mod in SKIP_SUBMODULES or (mod.startswith("_") and not include_private):
                continue
            qn = loc.modname + "." + mod
            if qn not in out:
                out.append(qn)
            if len(out) >= MAX_MODULES:
                return out
    return out


# ----------------------------------------------------------------------------- AST reading


def unparse(node):
    try:
        return ast.unparse(node)
    except Exception:
        return "…"


def clip(text, n=MAX_VALUE_CHARS):
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 1] + "…"


def decorator_names(node):
    return [unparse(d) for d in getattr(node, "decorator_list", [])]


def func_signature(node, decorators):
    prefix = "async def " if isinstance(node, ast.AsyncFunctionDef) else "def "
    sig = "%s%s(%s)" % (prefix, node.name, unparse(node.args))
    if node.returns is not None:
        sig += " -> " + unparse(node.returns)
    deco = [d for d in decorators if d not in ("staticmethod", "classmethod", "property")]
    if deco:
        sig = " ".join("@" + d for d in deco) + " " + sig
    return sig


def class_signature(node):
    bases = [unparse(b) for b in node.bases] + ["%s=%s" % (k.arg, unparse(k.value)) if k.arg else "**" + unparse(k.value) for k in node.keywords]
    sig = "class " + node.name + ("(%s)" % ", ".join(bases) if bases else "")
    deco = decorator_names(node)
    if deco:
        sig = " ".join("@" + d for d in deco) + " " + sig
    return sig


def is_private(name):
    return name.startswith("_") and not (name.startswith("__") and name.endswith("__"))


def is_module_dunder(name):
    """Module-level __name__/__package__/__doc__ etc. are noise; keep __version__-style metadata."""
    return name.startswith("__") and name.endswith("__") and name not in ("__version__", "__version_info__", "__author__")


def walk_top(body):
    """Module-level statements, descending into if/else and try blocks (common for compat imports)."""
    for stmt in body:
        if isinstance(stmt, ast.If):
            yield from walk_top(stmt.body)
            yield from walk_top(stmt.orelse)
        elif isinstance(stmt, ast.Try) or (hasattr(ast, "TryStar") and isinstance(stmt, getattr(ast, "TryStar"))):
            yield from walk_top(stmt.body)
            yield from walk_top(stmt.orelse)
        else:
            yield stmt


def literal_strings(node):
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return [e.value for e in node.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
    return None


class ModuleInfo:
    def __init__(self, modname, loc, tree):
        self.modname = modname
        self.loc = loc
        self.file = loc.file
        self.tree = tree
        self.local = {}  # name -> node
        self.imported = {}  # name -> (module, original name)
        self.star = []  # modules star-imported
        self.all = None
        self.docstring = ast.get_docstring(tree) if tree is not None else None
        if tree is not None:
            self._scan()

    def resolve_from(self, node):
        if node.level:
            base = self.modname.split(".")
            if not self.loc.is_package:
                base = base[:-1]
            if node.level > 1:
                base = base[: len(base) - (node.level - 1)]
            return ".".join(base + ([node.module] if node.module else []))
        return node.module or ""

    def _scan(self):
        top = self.modname.split(".")[0]
        for stmt in walk_top(self.tree.body):
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                if stmt.name in self.local and isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    prev = self.local[stmt.name]
                    self.local[stmt.name] = prev + [stmt] if isinstance(prev, list) else [prev, stmt]
                else:
                    self.local[stmt.name] = stmt
            elif isinstance(stmt, ast.Assign):
                for t in stmt.targets:
                    if isinstance(t, ast.Name):
                        if t.id == "__all__":
                            self.all = literal_strings(stmt.value) or self.all
                        else:
                            self.local.setdefault(t.id, stmt)
            elif isinstance(stmt, ast.AugAssign) and isinstance(stmt.target, ast.Name) and stmt.target.id == "__all__":
                extra = literal_strings(stmt.value)
                if extra:
                    self.all = (self.all or []) + extra
            elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
                self.local.setdefault(stmt.target.id, stmt)
            elif hasattr(ast, "TypeAlias") and isinstance(stmt, getattr(ast, "TypeAlias")):
                self.local.setdefault(stmt.name.id, stmt)
            elif isinstance(stmt, ast.ImportFrom):
                mod = self.resolve_from(stmt)
                if not mod or not (stmt.level or mod == top or mod.startswith(top + ".")):
                    # Third-party/stdlib import: only re-exported if it's explicitly listed in
                    # __all__ or uses the `import x as x` stub convention.
                    for a in stmt.names:
                        if a.name != "*" and a.asname and a.asname == a.name:
                            self.imported[a.asname] = (mod, a.name)
                        elif a.name != "*":
                            self.imported.setdefault("\0" + (a.asname or a.name), (mod, a.name))
                    continue
                for a in stmt.names:
                    if a.name == "*":
                        self.star.append(mod)
                    else:
                        self.imported[a.asname or a.name] = (mod, a.name)

    def foreign(self, name):
        return self.imported.get("\0" + name)

    def public_names(self, include_private):
        if self.all is not None:
            return list(self.all)
        names = [n for n in self.local if (include_private or not is_private(n)) and not is_module_dunder(n)]
        is_init = self.loc.is_package or (self.file or "").endswith(".pyi")
        if is_init:
            names += [n for n in self.imported if not n.startswith("\0") and (include_private or not is_private(n)) and n not in names]
        return names


class Reader:
    def __init__(self, include_private):
        self.include_private = include_private
        self.cache = {}
        self.entries = []
        self.files = []

    def module(self, modname):
        if modname in self.cache:
            return self.cache[modname]
        loc = locate(modname)
        info = None
        if loc is not None and loc.file:
            try:
                with open(loc.file, "rb") as fh:
                    tree = ast.parse(fh.read(), filename=loc.file)
            except (SyntaxError, ValueError, OSError):
                tree = None
            info = ModuleInfo(modname, loc, tree)
        elif loc is not None:
            info = ModuleInfo(modname, loc, None)
        self.cache[modname] = info
        return info

    def add(self, **e):
        if len(self.entries) < MAX_ENTRIES:
            self.entries.append(e)

    def where(self, mi, node):
        return {"source": mi.file, "line": getattr(node, "lineno", None)}

    # -- definitions

    def add_function(self, mi, node, name, container, kind="function", reexported=None):
        decos = decorator_names(node)
        if any(d.endswith((".setter", ".deleter")) for d in decos):
            return
        if kind == "method":
            if "property" in decos or any(d.endswith("cached_property") for d in decos):
                kind = "property"
            elif "classmethod" in decos:
                kind = "classmethod"
            elif "staticmethod" in decos:
                kind = "staticmethod"
            elif node.name == "__init__":
                kind = "constructor"
        sig = func_signature(node, decos)
        if kind == "property":
            sig = "@property " + sig
        elif kind in ("classmethod", "staticmethod"):
            sig = "@%s %s" % (kind, sig)
        self.add(kind=kind, name=name, container=container, signature=sig, docs=ast.get_docstring(node), reexportedFrom=reexported, **self.where(mi, node))

    def add_class(self, mi, node, name, container, reexported=None, depth=0):
        qn = name if not container else container + "." + name
        self.add(kind="class", name=name, container=container, signature=class_signature(node), docs=ast.get_docstring(node), reexportedFrom=reexported, **self.where(mi, node))
        for stmt in node.body:
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if is_private(stmt.name) and not self.include_private:
                    continue
                self.add_function(mi, stmt, stmt.name, qn, kind="method")
            elif isinstance(stmt, ast.ClassDef) and depth < 3:
                if is_private(stmt.name) and not self.include_private:
                    continue
                self.add_class(mi, stmt, stmt.name, qn, depth=depth + 1)
            elif isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
                n = stmt.target.id
                if is_private(n) and not self.include_private:
                    continue
                sig = "%s: %s" % (n, unparse(stmt.annotation))
                if stmt.value is not None:
                    sig += " = " + clip(unparse(stmt.value))
                self.add(kind="attribute", name=n, container=qn, signature=sig, docs=None, **self.where(mi, stmt))
            elif isinstance(stmt, ast.Assign):
                for t in stmt.targets:
                    if isinstance(t, ast.Name) and (self.include_private or not is_private(t.id)) and t.id not in ("__slots__", "__all__"):
                        self.add(kind="attribute", name=t.id, container=qn, signature="%s = %s" % (t.id, clip(unparse(stmt.value))), docs=None, **self.where(mi, stmt))

    def add_variable(self, mi, node, name, container, reexported=None):
        if isinstance(node, ast.AnnAssign):
            sig = "%s: %s" % (name, unparse(node.annotation))
            if node.value is not None:
                sig += " = " + clip(unparse(node.value))
        elif hasattr(ast, "TypeAlias") and isinstance(node, getattr(ast, "TypeAlias")):
            self.add(kind="type", name=name, container=container, signature=clip(unparse(node), 400), docs=None, reexportedFrom=reexported, **self.where(mi, node))
            return
        else:
            sig = "%s = %s" % (name, clip(unparse(node.value)))
        self.add(kind="variable", name=name, container=container, signature=sig, docs=None, reexportedFrom=reexported, **self.where(mi, node))

    def add_node(self, mi, node, name, container, reexported=None):
        if isinstance(node, list):
            for n in node:
                self.add_node(mi, n, name, container, reexported)
        elif isinstance(node, ast.ClassDef):
            self.add_class(mi, node, name, container, reexported)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            self.add_function(mi, node, name, container, reexported=reexported)
        else:
            self.add_variable(mi, node, name, container, reexported)

    # -- names and re-exports

    def resolve(self, modname, name, depth=0, seen=None):
        """Find where `name` exported by `modname` is defined: (ModuleInfo, node) or ("module", qualname) or None."""
        seen = seen or set()
        if depth > MAX_REEXPORT_DEPTH or (modname, name) in seen:
            return None
        seen.add((modname, name))
        mi = self.module(modname)
        if mi is None:
            return None
        if name in mi.local:
            return (mi, mi.local[name])
        imp = mi.imported.get(name) or mi.foreign(name)
        if imp:
            src_mod, orig = imp
            sub = src_mod + "." + orig
            if locate(sub) is not None and (self.module(src_mod) is None or orig not in (self.module(src_mod).local if self.module(src_mod) else {})):
                return ("module", sub)
            return self.resolve(src_mod, orig, depth + 1, seen)
        for star_mod in mi.star:
            r = self.resolve(star_mod, name, depth + 1, seen)
            if r is not None:
                return r
        # `from . import submodule` style or a submodule named in __all__
        if mi.loc.is_package and locate(modname + "." + name) is not None:
            return ("module", modname + "." + name)
        return None

    def star_names(self, modname, depth=0, seen=None):
        seen = seen or set()
        if depth > MAX_REEXPORT_DEPTH or modname in seen:
            return []
        seen.add(modname)
        mi = self.module(modname)
        if mi is None:
            return []
        names = mi.public_names(False) if mi.all is None else list(mi.all)
        if mi.all is None:
            for s in mi.star:
                names += [n for n in self.star_names(s, depth + 1, seen) if n not in names]
        return names

    def read_module(self, modname):
        mi = self.module(modname)
        if mi is None:
            return None
        names = mi.public_names(self.include_private)
        if mi.all is None:
            for s in mi.star:
                names += [n for n in self.star_names(s) if n not in names and (self.include_private or not is_private(n))]
        for name in names:
            r = self.resolve(modname, name)
            if r is None:
                imp = mi.imported.get(name) or mi.foreign(name)
                origin = imp[0] if imp else modname
                self.add(kind="name", name=name, container="", signature="%s  (from %s; definition not readable)" % (name, origin), docs=None, source=mi.file, line=None)
                continue
            if r[0] == "module":
                self.add(kind="module", name=name, container="", signature="module %s" % r[1], docs=None, source=None, line=None)
                continue
            src_mi, node = r
            reexported = src_mi.modname if src_mi.modname != modname else None
            self.add_node(src_mi, node, name, "", reexported)
        return mi


# ----------------------------------------------------------------------------- lib command


def pick_top(package, tops):
    """Main import name of a distribution: "PyYAML" -> "yaml" (not "_yaml"), "beautifulsoup4" -> "bs4"."""
    p = norm(package).replace("-", "")
    public = [t for t in tops if not t.startswith("_")] or tops
    for test in (lambda t: norm(t).replace("-", "") == p, lambda t: norm(t).replace("-", "") in p):
        hit = next((t for t in public if test(t)), None)
        if hit:
            return hit
    return public[0]


def split_symbol(top, module, symbol):
    """Move a module path at the front of `symbol` into `module`.

    With base module "requests": "requests.Session" -> ("requests", "Session"),
    "requests.adapters.HTTPAdapter" / "adapters.HTTPAdapter" -> ("requests.adapters", "HTTPAdapter").
    """
    if not symbol or "." not in symbol:
        return module, symbol
    parts = symbol.split(".")
    for i in range(len(parts) - 1, 0, -1):
        prefix, rest = ".".join(parts[:i]), ".".join(parts[i:])
        for cand in (prefix, module + "." + prefix):
            if cand == module:
                return module, rest
            if cand.startswith(top + ".") and locate(cand) is not None:
                return cand, rest
    return module, symbol


def cmd_lib():
    package = (ARGS.get("package") or "").strip()
    module = (ARGS.get("module") or "").strip() or None
    symbol = (ARGS.get("symbol") or "").strip() or None
    include_private = bool(ARGS.get("includePrivate"))
    if not re.match(r"^[A-Za-z0-9_][A-Za-z0-9._-]*$", package) or ".." in package:
        fail('"%s" is not a valid Python package or module name' % package)
    if module and not re.match(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$", module):
        fail('"%s" is not a valid dotted module name' % module)

    dist = find_distribution(package)
    tops = top_level_modules(dist) if dist else []
    if re.match(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$", package) and locate(package) is not None:
        root_module = package  # an import name ("bs4", "yaml", "json")
    elif tops:
        root_module = pick_top(package, tops)
    else:
        root_module = package.replace("-", "_")
    top = root_module.split(".")[0]

    # module="adapters" means "<root>.adapters"
    if module and module != top and not module.startswith(top + ".") and locate(root_module + "." + module) is not None:
        module = root_module + "." + module
    target, symbol = split_symbol(top, module or root_module, symbol)

    loc = locate(target)
    if loc is None:
        if dist is None and locate(root_module) is None:
            fail('Package "%s" is not installed for %s. Use py_list to see installed packages.' % (package, sys.executable))
        fail('Module "%s" not found. Available top-level modules: %s' % (target, ", ".join(tops) or root_module))

    reader = Reader(include_private)
    notes = []
    if loc.builtin:
        notes.append("%s is built into the interpreter (no source to read)." % target)
    elif loc.compiled and not loc.file:
        notes.append("%s is a compiled extension module (%s) without type stubs. py_lib reads source only and never imports packages, so its API can't be listed; look for a stubs package (types-%s) or use read on the package docs." % (target, os.path.basename(loc.compiled), package))
    elif loc.file is None and loc.is_package:
        notes.append("%s is a namespace package (no __init__); see its modules." % target)
    if loc.from_stubs == "stubs-package":
        notes.append("Signatures come from the %s-stubs package." % target.split(".")[0])
    elif loc.from_stubs == "inline":
        notes.append("Signatures come from the package's .pyi stub file.")

    mi = reader.read_module(target) if loc.file else None
    if loc.file and mi is not None and mi.tree is None:
        notes.append("Could not parse %s." % loc.file)
    if mi is not None and mi.all is not None:
        notes.append("Exports follow %s.__all__." % target)

    mods = submodules(loc, include_private)
    if not mi or not reader.entries:
        for m in mods:
            reader.add(kind="module", name=m.split(".")[-1], container="", signature="module " + m, docs=None, source=None, line=None)

    info = {
        "name": dist.metadata["Name"] if dist else root_module,
        "version": dist.version if dist else ("stdlib, Python %d.%d.%d" % sys.version_info[:3] if loc.file and is_stdlib(loc.file) else None),
        "location": os.path.dirname(loc.file) if loc.file and not loc.is_package else (loc.package_dirs[0] if loc.package_dirs else (loc.file or loc.compiled)),
        "apiSource": [loc.file] if loc.file else [],
        "summary": (dist.metadata.get("Summary") if dist else None) or first_paragraph(mi.docstring if mi else None),
        "modules": mods if mods else None,
        "module": target if target != root_module else None,
        "notes": notes,
    }
    if dist:
        reqs, optional = requirements(dist)
        info["dependencies"] = reqs + (["(+%d optional extras)" % optional] if optional else [])
        if len(tops) > 1:
            notes.append("This distribution provides several top-level modules: %s." % ", ".join(tops))
    return {
        "env": env_info(),
        "info": info,
        "entries": reader.entries,
        "rootContainer": "",
        "symbol": symbol,
        "moduleDocs": mi.docstring if mi else None,
    }


def first_paragraph(doc):
    if not doc:
        return None
    para = " ".join(doc.strip().split("\n\n")[0].split())
    return para if len(para) <= 200 else para[:199] + "…"


def is_stdlib(path):
    try:
        import sysconfig

        std = os.path.realpath(sysconfig.get_paths()["stdlib"])
        rp = os.path.realpath(path)
        return rp.startswith(std + os.sep) and "site-packages" not in rp and "dist-packages" not in rp
    except Exception:
        return False


def main():
    cmd = ARGS.get("cmd")
    if cmd == "list":
        out = cmd_list()
    elif cmd == "lib":
        out = cmd_lib()
    elif cmd == "env":
        out = {"env": env_info()}
    else:
        fail("unknown command %r" % cmd)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
