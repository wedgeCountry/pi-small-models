import { Type } from "typebox";

/**
 * Parameters shared by `ts_lib`, `py_lib` and `dotnet_lib`, so all three behave identically for a
 * small model: which view you get is decided by which parameters are present (no mode enum).
 */
export function libQueryParameters(examples: { package: string; module: string; symbol: string }) {
  return {
    package: Type.String({
      description: `Installed package name, e.g. "${examples.package}".`,
    }),
    module: Type.Optional(
      Type.String({
        description: `Sub-module / entry point / namespace to look in, e.g. "${examples.module}". Omit for the package's main entry point.`,
      })
    ),
    symbol: Type.Optional(
      Type.String({
        description: `Show exact signatures, docs and members of one symbol, e.g. "${examples.symbol}". Partial dotted names work.`,
      })
    ),
    query: Type.Optional(
      Type.String({ description: "Search all symbol names for this text (case-insensitive)." })
    ),
    includeDocs: Type.Optional(
      Type.Boolean({
        description: "Also show full documentation in the overview/search lists. Defaults to false (symbol= always shows docs).",
        default: false,
      })
    ),
    maxResults: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 1000, description: "Maximum entries to list. Defaults to 100 (overview), 50 (search), 200 (members)." })
    ),
  };
}

export function libQueryGuidelines(tool: string, ecosystem: string): string[] {
  return [
    `Use ${tool} to look up the real API of an installed ${ecosystem} package (the version actually installed) instead of guessing from memory.`,
    `Start with ${tool} package="…" for an overview, then symbol="Name" or symbol="Type.member" for exact signatures and docs, or query="text" to search names.`,
    `Use ${tool} before writing code against an unfamiliar package, or when a call fails with a missing member / wrong argument error.`,
  ];
}
