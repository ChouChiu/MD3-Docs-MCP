import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createMd3Server } from "../../src/app/create-server.js";
import { Md3Client } from "../../src/infrastructure/material/index.js";
import { encodeCursor } from "../../src/shared/pagination/cursor.js";
import { createFixtureFetch } from "../infrastructure/material/fixtures.js";

test("MCP tools and resources work over an in-memory transport", async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMd3Server(new Md3Client({ fetcher: createFixtureFetch() }));
  const client = new Client({ name: "md3-docs-test", version: "1.0.0" });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      "list_md3_docs",
      "read_md3_doc",
      "search_md3_docs",
    ]);

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
          offset: 1,
          path: "components/buttons/guidelines",
          section: "Guidelines",
          version: "old-version",
        }),
      },
    });
    assert.equal(staleCursorResult.isError, true);
    assert.match(
      staleCursorResult.content[0]?.type === "text" ? staleCursorResult.content[0].text : "",
      /CURSOR_STALE/,
    );

    const resources = await client.listResources();
    assert.equal(resources.resources.length, 3);
    const resource = await client.readResource({
      uri: "md3-docs://docs/components/buttons/guidelines",
    });
    const content = resource.contents[0];
    assert.ok(content && "text" in content);
    assert.match(content.text, /Keep labels concise/);
  } finally {
    await client.close();
    await server.close();
  }
});
