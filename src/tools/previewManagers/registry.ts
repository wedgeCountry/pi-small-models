import type { PreviewManager } from "./types.ts";
import { PythonPreviewManager } from "./python.ts";
import { TypeScriptPreviewManager } from "./typescript.ts";
import { CSharpPreviewManager } from "./csharp.ts";
import { MarkdownPreviewManager } from "./markdown.ts";

/**
 * Every PreviewManager `peek` knows about. Peek mode is selected purely by file extension: the
 * first manager listing the file's (lower-cased) extension handles it. Adding a language means
 * writing a new manager and appending it here.
 */
export const PREVIEW_MANAGERS: readonly PreviewManager[] = [
  new PythonPreviewManager(),
  new TypeScriptPreviewManager(),
  new CSharpPreviewManager(),
  new MarkdownPreviewManager(),
];

const BY_EXTENSION = new Map<string, PreviewManager>();
for (const manager of PREVIEW_MANAGERS) {
  for (const ext of manager.extensions) if (!BY_EXTENSION.has(ext)) BY_EXTENSION.set(ext, manager);
}

/** All supported extensions, e.g. `[".py", ".pyi", ".ts", …]`. */
export const PEEK_EXTENSIONS: readonly string[] = [...BY_EXTENSION.keys()];

export function previewManagerFor(extension: string): PreviewManager | undefined {
  return BY_EXTENSION.get(extension.toLowerCase());
}
