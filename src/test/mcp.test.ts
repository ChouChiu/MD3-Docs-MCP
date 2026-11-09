import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createMd3Server } from "../app/create-server.js";
import { Md3Client } from "../infrastructure/material/index.js";
import { encodeCursor } from "../shared/pagination/cursor.js";
import { createFixtureFetch } from "./fixtures.js";

const TOOL_NAMES = ["browse_md3_docs", "get_md3_context", "read_md3_doc", "search_md3_docs"];

/** Run one test against a freshly connected in-memory server/client pair. */
async function withServer(
  fetcher: typeof fetch,
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMd3Server(new Md3Client({ fetcher }));
  const client = new Client({ name: "md3-docs-test", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

/** Fixture fetch that answers `/search_api` with `payload`. */
function searchReturns(payload: unknown): typeof fetch {
  const base = createFixtureFetch();
  return (async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url,
    );
    if (url.pathname === "/search_api") return new Response(JSON.stringify(payload));
    return base(input);
  }) as typeof fetch;
}

test("MCP v2 tools work over an in-memory transport", async () => {
  await withServer(createFixtureFetch(), async (client) => {
    assert.equal(client.getServerVersion()?.version, "2.0.0");
    assert.equal(client.getServerCapabilities()?.resources, undefined);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), TOOL_NAMES);
    assert.ok(tools.tools.every((tool) => tool.outputSchema));

    const browse = await client.callTool({
      name: "browse_md3_docs",
      arguments: { category: "components", limit: 1 },
    });
    assert.equal(browse.isError, undefined);
    assert.equal(
      (browse.structuredContent as { entries: Array<{ path: string }> }).entries[0]?.path,
      "components/buttons/guidelines",
    );

    const result = await client.callTool({
      name: "read_md3_doc",
      arguments: { path: "components/buttons/guidelines", maxCharacters: 1_000 },
    });
    assert.equal(result.isError, undefined);
    assert.equal((result.structuredContent as { section?: string }).section, "Guidelines");

    const staleCursorResult = await client.callTool({
      name: "read_md3_doc",
      arguments: {
        path: "components/buttons/guidelines",
        cursor: encodeCursor({
          kind: "read",
          page: 1,
          path: "components/buttons/guidelines",
          section: "Guidelines",
          version: "old-version",
          maxCharacters: 12_000,
        }),
      },
    });
    assert.equal(staleCursorResult.isError, true);
    assert.match(
      staleCursorResult.content[0]?.type === "text" ? staleCursorResult.content[0].text : "",
      /CURSOR_STALE/,
    );

    const context = await client.callTool({
      name: "get_md3_context",
      arguments: {
        task: "Review button labels",
        mode: "review",
        paths: ["components/buttons/guidelines"],
        maxCharacters: 4_000,
      },
    });
    assert.equal(context.isError, undefined);
    const contextContent = context.structuredContent as {
      markdown: string;
      sources: Array<{ id: string; sourceUrl: string }>;
    };
    assert.match(contextContent.markdown, /\[S1\]/);
    assert.match(contextContent.markdown, /Keep labels concise/);
    assert.ok(contextContent.sources[0]?.sourceUrl.startsWith("https://m3.material.io/"));
  });
});

test("search ranks continue across cursor pages", async () => {
  const fetcher = searchReturns({
    items: [
      {
        title: "Buttons",
        link: "https://m3.material.io/components/buttons/overview",
        snippet: "First",
      },
      {
        title: "Button guidelines",
        link: "https://m3.material.io/components/buttons/guidelines",
        snippet: "Second",
      },
    ],
  });

  await withServer(fetcher, async (client) => {
    const first = await client.callTool({
      name: "search_md3_docs",
      arguments: { query: "buttons", limit: 1 },
    });
    const firstContent = first.structuredContent as {
      hits: Array<{ rank: number }>;
      nextCursor?: string;
    };
    assert.equal(firstContent.hits[0]?.rank, 1);
    assert.ok(firstContent.nextCursor);

    const second = await client.callTool({
      name: "search_md3_docs",
      arguments: { query: "buttons", limit: 1, cursor: firstContent.nextCursor },
    });
    const secondContent = second.structuredContent as { hits: Array<{ rank: number }> };
    assert.equal(secondContent.hits[0]?.rank, 2);
  });
});

test("browse cursor rejects a listing that no longer matches", async () => {
  await withServer(createFixtureFetch(), async (client) => {
    const first = await client.callTool({ name: "browse_md3_docs", arguments: { limit: 1 } });
    const { nextCursor } = first.structuredContent as { nextCursor?: string };
    assert.ok(nextCursor);

    const stale = await client.callTool({
      name: "browse_md3_docs",
      arguments: { limit: 1, category: "styles", cursor: nextCursor },
    });
    assert.equal(stale.isError, true);
    assert.match(stale.content[0]?.type === "text" ? stale.content[0].text : "", /CURSOR_STALE/);
  });
});

test("search cursor stays bound to its category", async () => {
  await withServer(createFixtureFetch(), async (client) => {
    const first = await client.callTool({
      name: "search_md3_docs",
      arguments: { query: "buttons", category: "components", limit: 1 },
    });
    const { nextCursor } = first.structuredContent as { nextCursor?: string };
    assert.ok(nextCursor);

    const mismatched = await client.callTool({
      name: "search_md3_docs",
      arguments: { query: "buttons", limit: 1, cursor: nextCursor },
    });
    assert.equal(mismatched.isError, true);
    assert.match(
      mismatched.content[0]?.type === "text" ? mismatched.content[0].text : "",
      /does not match the category/,
    );
  });
});
test("read pagination returns the next semantic page", async () => {
  const largeDocument = {
    title: "Buttons",
    sections: [
      {
        name: "Guidelines",
        isVisible: true,
        contentBlocks: Array.from({ length: 30 }, (_, index) => ({
          title: `Block ${index}`,
          contentChunks: [
            {
              htmlValue: `<p>Block ${index} guidance: ${"keep labels concise. ".repeat(12)}</p>`,
            },
          ],
        })),
      },
    ],
  };
  const baseFetcher = createFixtureFetch();
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url,
    );
    if (url.pathname.endsWith("/buttons.json")) {
      return new Response(JSON.stringify(largeDocument));
    }
    return baseFetcher(input);
  }) as typeof fetch;

  await withServer(fetcher, async (client) => {
    const first = await client.callTool({
      name: "read_md3_doc",
      arguments: { path: "components/buttons/guidelines", maxCharacters: 1_000 },
    });
    const firstContent = first.structuredContent as {
      markdown: string;
      nextCursor?: string;
      contentRange: { page: number; totalPages: number };
    };
    assert.ok(firstContent.nextCursor);
    assert.equal(firstContent.contentRange.page, 0);
    assert.ok(firstContent.contentRange.totalPages > 1);

    const second = await client.callTool({
      name: "read_md3_doc",
      arguments: {
        path: "components/buttons/guidelines",
        maxCharacters: 1_000,
        cursor: firstContent.nextCursor,
      },
    });
    assert.equal(second.isError, undefined);
    const secondContent = second.structuredContent as {
      markdown: string;
      contentRange: { page: number };
    };
    assert.equal(secondContent.contentRange.page, 1);
    assert.notEqual(secondContent.markdown, firstContent.markdown);
  });
});

test("browse prefix filters the directory before pagination", async () => {
  await withServer(createFixtureFetch(), async (client) => {
    const result = await client.callTool({
      name: "browse_md3_docs",
      arguments: { prefix: "/components/buttons/", limit: 10 },
    });
    const content = result.structuredContent as {
      entries: Array<{ path: string }>;
      total: number;
    };
    assert.equal(content.total, 2);
    assert.ok(content.entries.every((entry) => entry.path.startsWith("components/buttons/")));
  });
});

test("read returns the outline on a continuation page only when asked", async () => {
  const largeDocument = {
    title: "Buttons",
    sections: [
      {
        name: "Guidelines",
        isVisible: true,
        contentBlocks: Array.from({ length: 30 }, (_, index) => ({
          title: `Block ${index}`,
          contentChunks: [{ htmlValue: `<p>${"keep labels concise. ".repeat(12)}</p>` }],
        })),
      },
    ],
  };
  const baseFetcher = createFixtureFetch();
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url,
    );
    if (url.pathname.endsWith("/buttons.json")) {
      return new Response(JSON.stringify(largeDocument));
    }
    return baseFetcher(input);
  }) as typeof fetch;

  await withServer(fetcher, async (client) => {
    const first = await client.callTool({
      name: "read_md3_doc",
      arguments: { path: "components/buttons/guidelines", maxCharacters: 1_000 },
    });
    const firstContent = first.structuredContent as {
      availableHeadings?: string[];
      nextCursor?: string;
    };
    assert.equal(firstContent.availableHeadings?.length, 30);
    assert.ok(firstContent.nextCursor);

    const plain = await client.callTool({
      name: "read_md3_doc",
      arguments: {
        path: "components/buttons/guidelines",
        maxCharacters: 1_000,
        cursor: firstContent.nextCursor,
      },
    });
    assert.equal(
      (plain.structuredContent as { availableHeadings?: string[] }).availableHeadings,
      undefined,
    );

    const outlined = await client.callTool({
      name: "read_md3_doc",
      arguments: {
        path: "components/buttons/guidelines",
        maxCharacters: 1_000,
        cursor: firstContent.nextCursor,
        includeOutline: true,
      },
    });
    assert.deepEqual(
      (outlined.structuredContent as { availableHeadings?: string[] }).availableHeadings,
      Array.from({ length: 30 }, (_, index) => `Block ${index}`),
    );
  });
});
