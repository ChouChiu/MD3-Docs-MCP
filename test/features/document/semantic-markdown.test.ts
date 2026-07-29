import assert from "node:assert/strict";
import test from "node:test";
import {
  paginateDocument,
  type RenderedDocument,
  splitMarkdownSafely,
} from "../../../src/features/document/index.js";

test("semantic splitting preserves complete fenced code blocks", () => {
  const markdown = `Before

\`\`\`ts
${"const value = 1;\n".repeat(80)}\`\`\`

After`;
  const parts = splitMarkdownSafely(markdown, 300);

  assert.ok(parts.length > 2);
  for (const part of parts) {
    assert.ok(part.length <= 300);
    assert.equal((part.match(/```/g) ?? []).length % 2, 0);
  }
});

test("semantic splitting repeats table headers instead of breaking table syntax", () => {
  const markdown = [
    "| Name | Guidance |",
    "| --- | --- |",
    ...Array.from(
      { length: 20 },
      (_, index) => `| Item ${index} | ${"Use carefully ".repeat(3)} |`,
    ),
  ].join("\n");
  const parts = splitMarkdownSafely(markdown, 260);

  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.startsWith("| Name | Guidance |\n| --- | --- |")));
  assert.ok(parts.every((part) => part.length <= 260));
});

test("document pagination respects its character budget at semantic boundaries", () => {
  const document: RenderedDocument = {
    title: "Long document",
    basePath: "components/long",
    canonicalPath: "components/long/guidelines",
    sourceUrl: "https://m3.material.io/components/long/guidelines",
    section: "Guidelines",
    availableSections: ["Guidelines"],
    availableHeadings: ["Usage"],
    sections: [
      {
        name: "Guidelines",
        blocks: [
          {
            id: "block",
            heading: "Usage",
            chunks: [
              {
                id: "chunk",
                markdown: Array.from(
                  { length: 30 },
                  (_, index) => `Paragraph ${index}: ${"semantic guidance ".repeat(8)}`,
                ).join("\n\n"),
                media: [],
              },
            ],
          },
        ],
      },
    ],
    markdown: "",
    media: [],
    carbonVersion: "v1",
  };
  const pages = paginateDocument(document, 1_000);

  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => page.markdown.length <= 1_000));
  assert.ok(pages.every((page) => page.markdown.startsWith("# Long document")));
  assert.match(pages.at(-1)?.markdown ?? "", /Paragraph 29/);
});
