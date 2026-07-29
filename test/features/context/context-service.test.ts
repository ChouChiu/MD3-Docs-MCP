import assert from "node:assert/strict";
import test from "node:test";
import { ContextService } from "../../../src/features/context/index.js";
import { DocumentService } from "../../../src/features/document/index.js";
import { Md3Client } from "../../../src/infrastructure/material/index.js";
import { createFixtureFetch } from "../../infrastructure/material/fixtures.js";

test("context service builds cited, budgeted review evidence", async () => {
  const client = new Md3Client({ fetcher: createFixtureFetch() });
  const service = new ContextService(client, new DocumentService(client));
  const result = await service.getContext({
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
});

test("context service keeps useful results when one pinned path fails", async () => {
  const client = new Md3Client({ fetcher: createFixtureFetch() });
  const service = new ContextService(client, new DocumentService(client));
  const result = await service.getContext({
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
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url,
    );
    if (url.pathname === "/search_api") return new Response(JSON.stringify({ items: [] }));
    return fixtureFetch(input, init);
  }) as typeof fetch;
  const client = new Md3Client({ fetcher });
  const service = new ContextService(client, new DocumentService(client));

  await assert.rejects(
    service.getContext({
      task: "zyxwv unfindable",
      mode: "research",
      paths: [],
      maxSources: 2,
      maxCharacters: 4_000,
    }),
    /No official MD3 documents matched/,
  );
});
