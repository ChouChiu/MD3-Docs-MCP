import assert from "node:assert/strict";
import test from "node:test";
import { Md3Client } from "../../../src/infrastructure/material/client.js";
import { createFixtureFetch } from "./fixtures.js";

test("Material client lists, searches, resolves, and fetches raw documents", async () => {
  const client = new Md3Client({ fetcher: createFixtureFetch() });
  const directory = await client.getDirectory();
  assert.equal(directory.length, 3);
  assert.equal(directory[0]?.title, "Buttons — Guidelines");

  const search = await client.search("button", undefined, 1, 10);
  assert.equal(search.hits.length, 1);
  assert.equal(search.hits[0]?.path, "components/buttons/guidelines");

  const document = await client.getDocument("https://m3.material.io/components/buttons/guidelines");
  assert.equal(document.resolved.section, "Guidelines");
  assert.equal(document.document.title, "Buttons");
});

test("search pagination preserves remaining items in an upstream page", async () => {
  const starts: number[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url,
    );
    if (url.pathname !== "/search_api") return new Response("Not found", { status: 404 });
    starts.push(Number(url.searchParams.get("start")));
    return new Response(
      JSON.stringify({
        items: [
          {
            title: "Buttons",
            link: "https://m3.material.io/components/buttons",
            snippet: "First",
          },
          {
            title: "Cards",
            link: "https://m3.material.io/components/cards",
            snippet: "Second",
          },
        ],
        queries: { nextPage: [{ startIndex: 11 }] },
      }),
    );
  }) as typeof fetch;
  const client = new Md3Client({ fetcher });

  const first = await client.search("components", undefined, 1, 1);
  const second = await client.search(
    "components",
    undefined,
    first.nextStart,
    1,
    first.nextItemOffset,
  );

  assert.equal(first.hits[0]?.title, "Buttons");
  assert.equal(second.hits[0]?.title, "Cards");
  assert.deepEqual(starts, [1, 1]);
});

test("search rejects a malformed upstream response", async () => {
  const fetcher = (async () => new Response("{}")) as typeof fetch;
  const client = new Md3Client({ fetcher });
  await assert.rejects(client.search("buttons", undefined), /Invalid Material 3 search response/);
});

test("search does not emit a cursor at the exact end of the results", async () => {
  const fetcher = (async () =>
    new Response(
      JSON.stringify({
        items: [
          {
            title: "Buttons",
            link: "https://m3.material.io/components/buttons",
            snippet: "Only result",
          },
        ],
      }),
    )) as typeof fetch;
  const client = new Md3Client({ fetcher });

  const result = await client.search("buttons", undefined, 1, 1);

  assert.equal(result.hits.length, 1);
  assert.equal(result.nextStart, undefined);
  assert.equal(result.nextItemOffset, undefined);
});
