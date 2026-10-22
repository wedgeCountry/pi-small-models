# Installation

This extension disables `bash` and provides structured tools (including the dotnet, Python and npm/TypeScript coding tools) for smaller/weaker models. The base extension only needs the Pi coding agent; the coding tools additionally require the language toolchains below.

## Base

```bash
npm install
```

Installs the extension's own dependencies (`fast-glob`, `picomatch`, `typescript`) and dev dependencies (`tsx` for running the tests).

## .NET tools (`dotnet_build`, `dotnet_list`, `dotnet_lib`)

Requires the `dotnet` SDK on `PATH` and a project (`.csproj`/`.fsproj`/`.vbproj`) or solution (`.sln`/`.slnx`) in the workspace.

```bash
dotnet --version    # verify the SDK is installed
dotnet restore      # required before dotnet_lib: generates obj/project.assets.json
```

`dotnet_lib` reads `obj/project.assets.json` (or `artifacts/obj/<name>/`) to locate installed packages, so a restore must have been run at least once.

## Python tools (`py_lib`, `py_list`)

Requires Python **3.9+** (the `py_libinfo.py` helper uses `ast.unparse`). The interpreter is found in this order:

1. `$PI_SMALL_MODELS_PYTHON`
2. `$VIRTUAL_ENV` (an activated virtualenv)
3. a `.venv`, `venv` or `env` directory in the project root
4. `python3` (`python` on Windows) from `PATH`

Recommended per-project setup:

```bash
python3 -m venv .venv
.venv/bin/pip install <packages>    # Windows: .venv\Scripts\pip install <packages>
```

## npm/TypeScript tools (`npm_list`, `ts_check`, `ts_lib`)

Requires `npm` and `npx` on `PATH`, plus installed dependencies in the project (`node_modules` must exist):

```bash
npm install
npm install typescript    # for ts_check (npx tsc)
```

`ts_lib` uses the extension's own `typescript` dependency, so it works even when the project has no local TypeScript installed — but a `tsconfig.json` and installed packages give the best results.

## Unified tools (`build`, `test`, `lib_info`, `install`, `uninstall`)

These wrap the per-language tools for mixed projects; each detects which languages are present and skips the rest:

- `build`: `dotnet build` + `tsc --noEmit` + a Python import check of every `.py` file (`py_import`)
- `test`: `dotnet test` + `npm test` + `pytest`
- `lib_info`: the shared package-API views of `ts_lib` / `py_lib` / `dotnet_lib`, with the language auto-detected
- `install` / `uninstall`: npm / pip / NuGet, restricted to officially registered packages. The package
  name is validated against the registry grammar and the package's existence is confirmed against the
  registry's HTTP API (registry.npmjs.org / pypi.org / api.nuget.org) before the package manager runs.
  npm installs use `--ignore-scripts`; packages that need native compilation print the
  `npm rebuild <package> --build-from-source` instruction instead. pip installs update
  `requirements.txt` (created when absent); pip uninstalls remove the pin from it.

`install`/`uninstall` are the only tools that reach the network (registry existence check plus the
package manager itself) and mutate manifests (`package.json`, `requirements.txt`, `.csproj`).

## Running the tests

```bash
npm test
```

The full suite expects all three toolchains (`dotnet` SDK, Python 3.9+, `npm`) to be available on `PATH`.
