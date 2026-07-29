#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createMd3Server } from "./app/create-server.js";

async function main(): Promise<void> {
  const server = createMd3Server();
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
