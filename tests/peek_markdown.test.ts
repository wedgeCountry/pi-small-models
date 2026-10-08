import { test } from "node:test";
import assert from "node:assert/strict";
import { MarkdownPreviewManager } from "../src/tools/previewManagers/markdown.ts";

const manager = new MarkdownPreviewManager();
function peek(source: string, maxDepth = 6): string[] {
  return manager
    .preview(source.split("\n"), { visibility: "public", includeDocs: false, maxDepth })
    .map((l) => `${l.line}:${l.text}`);
}

const DOC = `# Title

Intro text that is dropped.

## Section A
More text.
### Sub A.1
#### Deep
## Section B`;

test("shows only headings, as a table of contents", () => {
  assert.deepEqual(peek(DOC), ["1:# Title", "5:## Section A", "7:### Sub A.1", "8:#### Deep", "9:## Section B"]);
});

test("maxDepth limits the heading levels", () => {
  assert.deepEqual(peek(DOC, 1), ["1:# Title"]);
  assert.deepEqual(peek(DOC, 2), ["1:# Title", "5:## Section A", "9:## Section B"]);
});

test("ignores # lines inside code fences, HTML comments and front matter", () => {
  const src = `---
title: x
# not a heading
---
# Real
\`\`\`bash
# a shell comment
\`\`\`
~~~
## also code
~~~
<!--
# commented out
-->
## After`;
  assert.deepEqual(peek(src), ["5:# Real", "15:## After"]);
});

test("does not treat #hashtag or indented code as headings", () => {
  assert.deepEqual(peek("#NoSpace\n    # indented code\n#\n## Ok"), ["3:#", "4:## Ok"]);
});

test("setext headings are shown with their underline and respect maxDepth", () => {
  const src = `Big Title
=========

Smaller
-------

- list item
---`;
  assert.deepEqual(peek(src), ["1:Big Title", "2:=========", "4:Smaller", "5:-------"]);
  assert.deepEqual(peek(src, 1), ["1:Big Title", "2:========="]);
});
