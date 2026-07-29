import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("package CLI serves MCP over a real stdio child process", {
  timeout: 15_000,
}, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["bin/md3-docs-mcp.js"],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "md3-docs-stdio-test", version: "1.0.0" });

  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      "list_md3_docs",
      "read_md3_doc",
      "search_md3_docs",
    ]);
  } finally {
    await client.close();
  }
});
