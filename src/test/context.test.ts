import assert from "node:assert/strict";
import test from "node:test";
import { ContextService } from "../features/context/index.js";
import { DocumentService } from "../features/document/index.js";
import { Md3Client } from "../infrastructure/material/index.js";
import { createFixtureFetch } from "./fixtures.js";

function service(fetcher: typeof fetch): ContextService {
  const client = new Md3Client({ fetcher });
  return new ContextService(client, new DocumentService(client));
}

test("context service builds cited, budgeted review evidence", async () => {
  const result = await service(createFixtureFetch()).getContext({
    task: "Review button labels and usage",
    mode: "review",
    paths: ["components/buttons/guidelines"],
    category: "components",
    maxSources: 3,
    maxCharacters: 4_000,
  });

  assert.ok(result.markdown.length <= 4_000);
  assert.match(result.markdown, /\[S1\]/);
  assert.match(result.markdown, /Keep labels concise/);
  assert.ok(result.checklist.length > 0);
  assert.ok(result.sources.every((source) => result.markdown.includes(source.id)));
  assert.ok(result.checklist.every((item) => result.markdown.includes(item.sourceId)));
});

test("context service keeps useful results when one pinned path fails", async () => {
  const result = await service(createFixtureFetch()).getContext({
    task: "button guidance",
    mode: "research",
    paths: ["components/does-not-exist"],
    maxSources: 2,
    maxCharacters: 4_000,
  });

  assert.match(result.markdown, /Buttons/);
  assert.ok(result.warnings.some((warning) => warning.includes("Pinned path")));
});

test("context service reports no matches without inventing evidence", async () => {
  const fixtureFetch = createFixtureFetch();
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url,
    );
    if (url.pathname === "/search_api") return new Response(JSON.stringify({ items: [] }));
    return fixtureFetch(input);
  }) as typeof fetch;

  await assert.rejects(
    service(fetcher).getContext({
      task: "zyxwv unfindable",
      mode: "research",
      paths: [],
      maxSources: 2,
      maxCharacters: 4_000,
    }),
    /No official MD3 documents matched/,
  );
});
test("context only reports sources and checklist items that survived the budget", async () => {
  const fixtureFetch = createFixtureFetch();
  const largeDocument = {
    title: "Buttons",
    sections: [
      {
        name: "Overview",
        isVisible: true,
        contentBlocks: [
          {
            title: "Usage",
            contentChunks: [{ htmlValue: `<p>${"Overview guidance ".repeat(300)}</p>` }],
          },
        ],
      },
      {
        name: "Guidelines",
        isVisible: true,
        contentBlocks: [
          {
            title: "Labels",
            contentChunks: [{ htmlValue: "<p>Keep labels concise.</p>" }],
          },
        ],
      },
    ],
  };
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url,
    );
    if (url.pathname.endsWith("/buttons.json")) {
      return new Response(JSON.stringify(largeDocument));
    }
    return fixtureFetch(input);
  }) as typeof fetch;

  const result = await service(fetcher).getContext({
    task: "Review button guidance",
    mode: "research",
    paths: ["components/buttons/overview"],
    maxSources: 2,
    maxCharacters: 4_000,
  });

  assert.ok(result.markdown.length <= 4_000);
  assert.equal(result.truncated, true);
  assert.equal(result.sources.length, 1);
  assert.ok(result.sources.every((source) => result.markdown.includes(`[${source.id}]`)));
  assert.ok(result.checklist.every((item) => result.markdown.includes(`[${item.sourceId}]`)));
});
test("context reports an upstream error when every discovery source fails", async () => {
  const fetcher = (async () => new Response("down", { status: 404 })) as typeof fetch;

  await assert.rejects(
    service(fetcher).getContext({
      task: "button guidance",
      mode: "research",
      paths: [],
      maxSources: 2,
      maxCharacters: 4_000,
    }),
    /search and document directory were unavailable/,
  );
});
