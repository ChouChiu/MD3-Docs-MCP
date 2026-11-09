import assert from "node:assert/strict";
import test from "node:test";
import {
  blockHeadings,
  includesHeading,
  paginateDocument,
  type RenderedDocument,
  type SemanticBlock,
  type SemanticChunk,
  type SemanticSection,
  selectHeading,
  splitMarkdownSafely,
} from "../features/document/index.js";

function block(
  markdowns: string[],
  options: { id?: string; heading?: string } = {},
): SemanticBlock {
  const chunks: SemanticChunk[] = markdowns.map((markdown, index) => ({
    id: options.id ? `${options.id}-${index}` : `chunk-${index}`,
    markdown,
    media: [],
  }));
  return {
    id: options.id ?? "block",
    ...(options.heading ? { heading: options.heading } : {}),
    chunks,
  };
}

function section(name: string, blocks: SemanticBlock[]): SemanticSection {
  return { name, blocks };
}

function text(sections: readonly SemanticSection[]): string {
  return sections
    .flatMap((value) =>
      value.blocks.flatMap((value) => value.chunks.map((chunk) => chunk.markdown)),
    )
    .join("\n");
}

function documentOf(
  sections: RenderedDocument["sections"],
  description?: string,
): RenderedDocument {
  return {
    title: "Long document",
    ...(description ? { description } : {}),
    basePath: "components/long",
    canonicalPath: "components/long/guidelines",
    sourceUrl: "https://m3.material.io/components/long/guidelines",
    availableSections: sections.map((section) => section.name),
    availableHeadings: [],
    sections,
    markdown: "",
    media: [],
    carbonVersion: "v1",
  };
}

test("a heading keeps the body that continues in following blocks", () => {
  const sections = [
    section("Guidelines", [
      block(["## Usage"]),
      block(["Buttons communicate actions."]),
      block(["They sit throughout the interface."]),
      block(["## Toggle buttons"]),
      block(["Toggle buttons handle binary selections."]),
    ]),
  ];

  const selected = selectHeading(sections, "Usage");
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.blocks.length, 3);
  const body = text(selected);
  assert.match(body, /communicate actions/);
  assert.match(body, /throughout the interface/);
  assert.doesNotMatch(body, /binary selections/);
});

test("nested headings stay inside the selection until a peer heading", () => {
  const sections = [
    section("Guidelines", [
      block([
        "## Anatomy",
        "### Label text",
        "Label text is the most important element.",
        "### Container",
        "Containers hold the label.",
        "## Color styles",
        "Elevated buttons use a shadow.",
      ]),
    ]),
  ];

  const anatomy = selectHeading(sections, "anatomy");
  assert.match(text(anatomy), /Containers hold the label/);
  assert.doesNotMatch(text(anatomy), /Elevated buttons/);

  const label = selectHeading(sections, "Label  text");
  assert.match(text(label), /most important element/);
  assert.doesNotMatch(text(label), /Containers hold/);
  assert.doesNotMatch(text(label), /Elevated buttons/);
});

test("a block title can start a selection", () => {
  const sections = [
    section("Overview", [
      block([], { id: "usage", heading: "Usage" }),
      block(["Buttons prompt actions."], { id: "body" }),
      block([], { id: "anatomy", heading: "Anatomy" }),
      block(["Anatomy body."], { id: "anatomy-body" }),
    ]),
  ];

  const selected = selectHeading(sections, "Usage");
  assert.deepEqual(
    selected[0]?.blocks.map((value) => value.id),
    ["usage", "body"],
  );
  assert.equal(
    includesHeading(blockHeadings(sections[0]?.blocks[0] as SemanticBlock), "usage"),
    true,
  );
});

test("heading markup inside fenced code is ignored", () => {
  const sections = [
    section("Guidelines", [block(["```\n## Usage\n```", "## Real heading", "Real body"])]),
  ];

  assert.match(text(selectHeading(sections, "Real heading")), /Real body/);
  assert.deepEqual(selectHeading(sections, "Usage"), []);
});

test("selection stops at the end of a section and ignores unknown headings", () => {
  const sections = [
    section("First", [block(["## Usage"]), block(["First body"])]),
    section("Second", [block(["Second body"])]),
  ];

  assert.equal(selectHeading(sections, "Usage").length, 1);
  assert.doesNotMatch(text(selectHeading(sections, "Usage")), /Second body/);
  assert.deepEqual(selectHeading(sections, "Missing heading"), []);
});

test("block headings list titles and chunk headings once", () => {
  const value = block(["## Usage", "Text"], { heading: "Usage" });
  assert.deepEqual(blockHeadings(value), ["Usage"]);
});

test("splitting preserves complete fenced code blocks", () => {
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

test("splitting repeats table headers instead of breaking table syntax", () => {
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

test("splitting never exceeds the budget for unbroken text", () => {
  const value = "x".repeat(950);
  const parts = splitMarkdownSafely(value, 100);

  assert.ok(parts.every((part) => part.length <= 100));
  assert.equal(parts.join(""), value);
});

test("pagination respects its budget and keeps content order", () => {
  const paragraphs = Array.from(
    { length: 30 },
    (_, index) => `Paragraph ${index}: ${"semantic guidance ".repeat(8)}`,
  );
  const document = documentOf(
    [
      {
        name: "Guidelines",
        blocks: [
          {
            id: "block",
            heading: "Usage",
            chunks: [{ id: "chunk", markdown: paragraphs.join("\n\n"), media: [] }],
          },
        ],
      },
    ],
    "Official document summary.",
  );

  const pages = paginateDocument(document, 1_000);
  assert.ok(pages.length > 1);
  assert.ok(pages.every((page) => page.markdown.length <= 1_000));
  assert.ok(pages.every((page) => page.markdown.startsWith("# Long document")));

  // Long paragraphs are split at sentence boundaries, so assert on paragraph starts.
  const joined = pages.map((page) => page.markdown).join("\n");
  for (let index = 0; index < paragraphs.length; index += 1) {
    assert.ok(joined.includes(`Paragraph ${index}:`), `missing paragraph ${index}`);
  }
  assert.equal(pages[0]?.markdown.match(/Official document summary\./g)?.length, 1);
  assert.equal(
    pages.slice(1).some((page) => page.markdown.includes("Official document summary.")),
    false,
  );
});

test("pagination keeps every page within budget for long section names", () => {
  const document = documentOf([
    {
      name: "A".repeat(300),
      blocks: [{ id: "block", chunks: [{ id: "chunk", markdown: "short body", media: [] }] }],
    },
  ]);

  for (const budget of [1_000, 1_200]) {
    const pages = paginateDocument(document, budget);
    assert.ok(pages.every((page) => page.markdown.length <= budget));
  }
});

test("pagination reports block ranges that cover the selected content", () => {
  const document = documentOf([
    {
      name: "Guidelines",
      blocks: [
        { id: "a", chunks: [{ id: "a1", markdown: "First block.", media: [] }] },
        { id: "b", chunks: [{ id: "b1", markdown: "Second block.", media: [] }] },
      ],
    },
  ]);

  const pages = paginateDocument(document, 30_000);
  assert.equal(pages.length, 1);
  assert.deepEqual({ start: pages[0]?.startBlock, end: pages[0]?.endBlock }, { start: 0, end: 1 });
});
