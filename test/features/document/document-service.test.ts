import assert from "node:assert/strict";
import test from "node:test";
import { DocumentService } from "../../../src/features/document/index.js";
import { Md3Client } from "../../../src/infrastructure/material/index.js";
import { createFixtureFetch, documentJson } from "../../infrastructure/material/fixtures.js";

test("document feature renders a default Overview with media", async () => {
  const client = new Md3Client({ fetcher: createFixtureFetch() });
  const documents = new DocumentService(client);
  const document = await documents.readDocument("components/buttons");

  assert.equal(document.section, "Overview");
  assert.match(document.markdown, /important/);
  assert.match(document.markdown, /Five button variants/);
  assert.equal(document.media.length, 1);
});

test("document feature selects the requested tab", async () => {
  const client = new Md3Client({ fetcher: createFixtureFetch() });
  const documents = new DocumentService(client);
  const document = await documents.readDocument(
    "https://m3.material.io/components/buttons/guidelines",
  );

  assert.equal(document.section, "Guidelines");
  assert.match(document.markdown, /Keep labels concise/);
  assert.doesNotMatch(document.markdown, /important actions/);
});

test("document feature rejects a missing section on a route without tabs", async () => {
  const fixtureFetch = createFixtureFetch();
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url,
    );
    if (url.pathname.endsWith("/color.json")) return new Response(documentJson);
    return fixtureFetch(input, init);
  }) as typeof fetch;
  const documents = new DocumentService(new Md3Client({ fetcher }));

  await assert.rejects(documents.readDocument("styles/color", "Missing"), /section was not found/);
});
