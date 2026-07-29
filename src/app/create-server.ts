import { McpServer } from "@modelcontextprotocol/server";
import { registerCatalogFeature } from "../features/catalog/index.js";
import { DocumentService, registerDocumentFeature } from "../features/document/index.js";
import { registerResourcesFeature } from "../features/resources/index.js";
import { registerSearchFeature } from "../features/search/index.js";
import { Md3Client } from "../infrastructure/material/index.js";

export function createMd3Server(client = new Md3Client()): McpServer {
  const server = new McpServer(
    { name: "MD3-Docs", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );
  const documents = new DocumentService(client);

  registerCatalogFeature(server, client);
  registerSearchFeature(server, client);
  registerDocumentFeature(server, documents);
  registerResourcesFeature(server, client, documents);

  return server;
}
