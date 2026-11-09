import assert from "node:assert/strict";
import test from "node:test";
import { DocumentService, renderDocument } from "../features/document/index.js";
import { renderResource } from "../features/document/render-resource.js";
import { Md3Client } from "../infrastructure/material/index.js";
import type { DocumentData } from "../infrastructure/material/types.js";
import { createFixtureFetch, documentJson } from "./fixtures.js";

/** Fixture fetch that replaces the document behind `pathSuffix` with `body` (JSON text). */
function respondWith(pathSuffix: string, body: string): typeof fetch {
  const base = createFixtureFetch();
  return (async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url,
    );
    if (url.pathname.endsWith(pathSuffix)) return new Response(body);
    return base(input);
  }) as typeof fetch;
}

function service(fetcher: typeof fetch): DocumentService {
  return new DocumentService(new Md3Client({ fetcher }));
}

test("document feature renders a default Overview with media", async () => {
  const document = await service(createFixtureFetch()).readDocument("components/buttons");

  assert.equal(document.section, "Overview");
  assert.match(document.markdown, /important/);
  assert.match(document.markdown, /Five button variants/);
  assert.equal(document.media.length, 1);
});

test("document feature selects the requested tab", async () => {
  const document = await service(createFixtureFetch()).readDocument(
    "https://m3.material.io/components/buttons/guidelines",
  );

  assert.equal(document.section, "Guidelines");
  assert.match(document.markdown, /Keep labels concise/);
  assert.doesNotMatch(document.markdown, /important actions/);
});

test("document feature selects an exact nested heading", async () => {
  const nestedDocument = JSON.parse(documentJson) as {
    sections: Array<{
      name: string;
      contentBlocks: Array<{ contentChunks: Array<{ htmlValue?: string }> }>;
    }>;
  };
  const guidelines = nestedDocument.sections.find((section) => section.name === "Guidelines");
  const chunk = guidelines?.contentBlocks[0]?.contentChunks[0];
  if (chunk) {
    chunk.htmlValue =
      "<h2>Before</h2><p>Before body.</p>" +
      "<h2>Labels</h2><p>Keep labels concise.</p>" +
      "<h3>Supporting text</h3><p>Use supporting text carefully.</p>" +
      "<h2>After</h2><p>After body.</p>";
  }
  const document = await service(
    respondWith("/buttons.json", JSON.stringify(nestedDocument)),
  ).readDocument("components/buttons/guidelines", undefined, "Labels");

  assert.deepEqual(document.availableHeadings, ["Before", "Labels", "Supporting text", "After"]);
  assert.match(document.markdown, /Keep labels concise/);
  assert.match(document.markdown, /Use supporting text carefully/);
  assert.doesNotMatch(document.markdown, /Before body/);
  assert.doesNotMatch(document.markdown, /After body/);
  assert.doesNotMatch(document.markdown, /important actions/);
});

test("document feature keeps heading content that continues in later blocks", async () => {
  const blocksDocument = {
    title: "Buttons",
    sections: [
      {
        name: "Guidelines",
        isVisible: true,
        contentBlocks: [
          { contentChunks: [{ htmlValue: "<h2>Usage</h2>" }] },
          { contentChunks: [{ htmlValue: "<p>Buttons communicate actions.</p>" }] },
          { contentChunks: [{ htmlValue: "<h2>Toggle buttons</h2><p>Toggle body.</p>" }] },
        ],
      },
    ],
  };
  const document = await service(
    respondWith("/buttons.json", JSON.stringify(blocksDocument)),
  ).readDocument("components/buttons/guidelines", undefined, "Usage");

  assert.match(document.markdown, /Buttons communicate actions/);
  assert.doesNotMatch(document.markdown, /Toggle body/);
  assert.deepEqual(document.availableHeadings, ["Usage", "Toggle buttons"]);
});

test("a heading from another section reports where it lives", async () => {
  const documents = service(createFixtureFetch());

  await assert.rejects(
    documents.readDocument("components/buttons", undefined, "Labels"),
    (error: unknown) => {
      const details = (error as { details?: Record<string, unknown> }).details;
      assert.equal((error as { code?: string }).code, "NOT_FOUND");
      assert.deepEqual(details?.headingSections, ["Guidelines"]);
      assert.deepEqual(details?.availableSections, ["Overview", "Guidelines"]);
      return true;
    },
  );

  const scoped = await documents.readDocument("components/buttons/guidelines", undefined, "Labels");
  assert.match(scoped.markdown, /Keep labels concise/);
});

test("document feature rejects a missing section on a route without tabs", async () => {
  const documents = service(respondWith("/color.json", documentJson));
  await assert.rejects(documents.readDocument("styles/color", "Missing"), /section was not found/);
});

test("document rendering loads independent resource tables concurrently", async () => {
  const document: DocumentData = {
    title: "Concurrent resources",
    sections: [
      {
        name: "Overview",
        contentBlocks: [
          {
            contentChunks: [
              { resourceName: "designSystems/test/one" },
              { resourceName: "designSystems/test/two" },
            ],
          },
        ],
      },
    ],
  };
  let active = 0;
  let maximumActive = 0;
  const rendered = await renderDocument(document, "components/test", "version", async (name) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { displayName: name };
  });

  assert.equal(maximumActive, 2);
  assert.equal(rendered.sections[0]?.blocks[0]?.chunks.length, 2);
});
test("an unavailable resource table renders an explicit placeholder", async () => {
  const document: DocumentData = {
    title: "Resource placeholders",
    sections: [
      {
        name: "Overview",
        contentBlocks: [{ contentChunks: [{ resourceName: "designSystems/test/missing" }] }],
      },
    ],
  };
  const rendered = await renderDocument(document, "components/test", "version", async () => {
    throw new Error("resource unavailable");
  });
  const markdown = rendered.sections[0]?.blocks[0]?.chunks[0]?.markdown;

  assert.match(markdown ?? "", /designSystems\/test\/missing/);
  assert.match(markdown ?? "", /currently unavailable/);
});

test("resource tables escape Markdown cells and keep connection order", () => {
  const markdown = renderResource({
    displayName: "Button tokens",
    definition: "Token connections.",
    connections: [
      {
        displayName: "Second",
        orderInComponent: 2,
        resourceType: "design_token",
        status: "live",
      },
      {
        displayName: "First | [draft]",
        orderInComponent: 1,
        resourceType: "design_token",
        status: "in review",
      },
    ],
  });

  assert.ok(markdown.includes("First \\| \\[draft\\]"));
  assert.ok(markdown.indexOf("First") < markdown.indexOf("Second"));
  assert.match(markdown, /\| design token \| in review \|/);
});

test("renders every supported media type with its source URL", async () => {
  const document: DocumentData = {
    title: "Media",
    sections: [
      {
        name: "Overview",
        contentBlocks: [
          {
            contentChunks: [
              {
                htmlValue: "<p>Media body.</p>",
                imageUrl: "https://example.invalid/image.png",
                imageWidth: 800,
                imageHeight: 400,
                altText: "Image alt",
                footer: "<p>Image caption</p>",
                videoUrl: "https://example.invalid/video.mp4",
                videoWidth: 640,
                videoHeight: 480,
                prototypeUrl: "https://example.invalid/prototype",
                codeUrl: "https://example.invalid/code",
                linkUrl: "https://example.invalid/related",
              },
            ],
          },
        ],
      },
    ],
  };
  const rendered = await renderDocument(
    document,
    "components/test",
    "version",
    async () => undefined,
  );
  const chunk = rendered.sections[0]?.blocks[0]?.chunks[0];

  assert.deepEqual(
    chunk?.media.map((item) => item.type),
    ["image", "video", "prototype", "code"],
  );
  assert.match(chunk?.markdown ?? "", /!\[Image alt\]\(https:\/\/example\.invalid\/image\.png\)/);
  assert.match(chunk?.markdown ?? "", /\[Image alt\]\(https:\/\/example\.invalid\/video\.mp4\)/);
  assert.match(
    chunk?.markdown ?? "",
    /\[Related resource\]\(https:\/\/example\.invalid\/related\)/,
  );
});
