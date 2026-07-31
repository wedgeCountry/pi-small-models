import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveSafePath } from "../src/pathSafety.ts";
import { listDir } from "../src/list.ts";

export function registerListTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "list",
    label: "List",
    description: "List files and directories within the project.",
    promptSnippet: "list: list directory contents (bash is disabled)",
    promptGuidelines: [
      "Use list to see the files and subdirectories inside a directory.",
      "Use list instead of a bash `ls`/`dir`/`tree` command — bash is disabled in this project.",
    ],
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: 'Directory to list, relative to the project root. Defaults to ".".' })
      ),
      recursive: Type.Optional(Type.Boolean({ description: "List subdirectories recursively.", default: false })),
      maxDepth: Type.Optional(
        Type.Integer({ description: "Maximum recursion depth when recursive is true.", default: 3 })
      ),
      showHidden: Type.Optional(Type.Boolean({ description: "Include dotfiles and dot-directories.", default: false })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const base = resolveSafePath(ctx.cwd, params.path ?? ".");
      const entries = await listDir(base, {
        recursive: params.recursive,
        maxDepth: params.maxDepth,
        showHidden: params.showHidden,
        signal,
      });

      const text = entries.length
        ? entries.map((e) => (e.isDirectory ? `${e.path}/` : e.path)).join("\n")
        : "(empty directory)";

      return {
        content: [{ type: "text", text }],
        details: { entries },
      };
    },
  });
}
