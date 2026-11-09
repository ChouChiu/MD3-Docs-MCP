#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createMd3Server } from "./app/create-server.js";
import { Md3Client } from "./infrastructure/material/index.js";

async function main(): Promise<void> {
  const client = new Md3Client();
  const server = createMd3Server(client);
  // Warm the directory cache while the host is still handing over the connection, so the
  // first browse/search does not pay for the site index, main bundle, and sitemap.
  if (process.env.MD3_WARMUP !== "0") {
    void client.getDirectory().catch(() => {
      // A cold start that fails here is reported by the tool call that needs it.
    });
  }
  const transport = new StdioServerTransport();
  transport.onerror = (error) => {
    console.error("[MD3-Docs] stdio transport error:", error);
  };
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error("[MD3-Docs] fatal error:", error);
  process.exitCode = 1;
});
