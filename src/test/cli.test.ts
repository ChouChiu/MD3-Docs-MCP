import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const TOOL_NAMES = ["browse_md3_docs", "get_md3_context", "read_md3_doc", "search_md3_docs"];

test("compiled CLI serves MCP over stdio", { timeout: 15_000 }, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "md3-docs-stdio-test", version: "1.0.0" });

  await client.connect(transport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), TOOL_NAMES);
  } finally {
    await client.close();
  }
});

test("packed npm artifact runs from an installed package layout", {
  timeout: 30_000,
}, async () => {
  const cacheRoot = join(process.cwd(), ".cache");
  mkdirSync(cacheRoot, { recursive: true });
  const temporary = mkdtempSync(join(cacheRoot, "package-test-"));
  try {
    const packed = spawnSync(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    assert.equal(packed.status, 0, packed.stderr);
    const metadata = JSON.parse(packed.stdout) as Array<{ filename: string }>;
    const archive = join(temporary, metadata[0]?.filename ?? "");
    const packageRoot = join(temporary, "node_modules", "md3-docs-mcp");
    mkdirSync(packageRoot, { recursive: true });
    const extracted = spawnSync(
      "tar",
      ["-xzf", archive, "-C", packageRoot, "--strip-components=1"],
      { encoding: "utf8" },
    );
    assert.equal(extracted.status, 0, extracted.stderr);
    assert.ok(existsSync(join(packageRoot, "dist", "index.js")));
    assert.equal(existsSync(join(packageRoot, "src")), false);

    const executable = join(packageRoot, "dist", "index.js");
    chmodSync(executable, 0o755);
    const client = new Client({ name: "packed-md3-docs-test", version: "1.0.0" });
    await client.connect(
      new StdioClientTransport({ command: executable, cwd: temporary, stderr: "pipe" }),
    );
    try {
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), TOOL_NAMES);
    } finally {
      await client.close();
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
