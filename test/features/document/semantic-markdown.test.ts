import assert from "node:assert/strict";
import test from "node:test";
import {
  paginateDocument,
  type RenderedDocument,
  splitMarkdownSafely,
} from "../../../src/features/document/index.js";

test("semantic splitting preserves complete fenced code blocks", () => {
  const body = Array.from(
    { length: 40 },
    (_, index) => `if (condition${index}) {\n    nestedCall(${index});\n}`,
  ).join("\n");
  const markdown = `\`\`\`ts\n${body}\n\`\`\``;
  const parts = splitMarkdownSafely(markdown, 300);

  assert.ok(parts.length > 2);
  for (const part of parts) {
    assert.ok(part.length <= 300);
    assert.equal((part.match(/```/g) ?? []).length % 2, 0);
  }
  const reconstructed = parts.map((part) => part.split("\n").slice(1, -1).join("\n")).join("\n");
  assert.equal(reconstructed, body);
  assert.doesNotMatch(reconstructed, /^nestedCall/gm);
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
    description: "Official document summary.",
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
  assert.equal(
    pages.reduce(
      (count, page) => count + (page.markdown.match(/Official document summary\./g) ?? []).length,
      0,
    ),
    1,
  );
  assert.match(pages.at(-1)?.markdown ?? "", /Paragraph 29/);
});
