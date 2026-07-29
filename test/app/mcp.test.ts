import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createMd3Server } from "../../src/app/create-server.js";
import { Md3Client } from "../../src/infrastructure/material/index.js";
import { encodeCursor } from "../../src/shared/pagination/cursor.js";
import { createFixtureFetch } from "../infrastructure/material/fixtures.js";

test("MCP v2 tools work over an in-memory transport", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMd3Server(new Md3Client({ fetcher: createFixtureFetch() }));
  const client = new Client({ name: "md3-docs-test", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    assert.equal(client.getServerVersion()?.version, "2.0.0");
    assert.equal(client.getServerCapabilities()?.resources, undefined);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      "browse_md3_docs",
      "get_md3_context",
      "read_md3_doc",
      "search_md3_docs",
    ]);
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
  } finally {
    await client.close();
    await server.close();
  }
});

test("search ranks continue across cursor pages", async () => {
  const fixtureFetch = createFixtureFetch();
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url,
    );
    if (url.pathname === "/search_api") {
      return new Response(
        JSON.stringify({
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
        }),
      );
    }
    return fixtureFetch(input, init);
  }) as typeof fetch;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMd3Server(new Md3Client({ fetcher }));
  const client = new Client({ name: "md3-docs-rank-test", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
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
  } finally {
    await client.close();
    await server.close();
  }
});
