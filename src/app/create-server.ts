import { McpServer } from "@modelcontextprotocol/server";
import { registerBrowseFeature } from "../features/catalog/index.js";
import { ContextService, registerContextFeature } from "../features/context/index.js";
import { DocumentService, registerDocumentFeature } from "../features/document/index.js";
import { registerSearchFeature } from "../features/search/index.js";
import { Md3Client } from "../infrastructure/material/index.js";
import { APP_VERSION } from "../shared/version.js";

/** Compose every feature tool onto one MCP server. */
export function createMd3Server(client = new Md3Client()): McpServer {
  const server = new McpServer(
    { name: "MD3-Docs", version: APP_VERSION },
    { capabilities: { tools: {} } },
  );
  const documents = new DocumentService(client);
  const contexts = new ContextService(client, documents);

  registerBrowseFeature(server, client);
  registerSearchFeature(server, client);
  registerDocumentFeature(server, documents);
  registerContextFeature(server, contexts);

  return server;
}
