import { type McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import type { Md3Client } from "../../infrastructure/material/index.js";
import { Md3Error } from "../../shared/errors/md3-error.js";
import type { DocumentService } from "../document/index.js";

export function registerResourcesFeature(
  server: McpServer,
  client: Md3Client,
  documents: DocumentService,
): void {
  const template = new ResourceTemplate("md3-docs://docs/{+path}", {
    list: async () => {
      const directory = await client.getDirectory();
      return {
        resources: directory.map((entry) => ({
          name: entry.title,
          uri: `md3-docs://docs/${entry.path}`,
          mimeType: "text/markdown",
          ...(entry.description ? { description: entry.description } : {}),
        })),
      };
    },
    complete: {
      path: async (value) => {
        const directory = await client.getDirectory();
        return directory
          .map((entry) => entry.path)
          .filter((path) => path.startsWith(value))
          .slice(0, 100);
      },
    },
  });

  server.registerResource(
    "md3-document",
    template,
    {
      title: "Material Design 3 document",
      description: "A live Material Design 3 document rendered as Markdown.",
      mimeType: "text/markdown",
      cacheHint: { ttlMs: 300_000, cacheScope: "public" },
    },
    async (uri, variables) => {
      const path = variables.path;
      if (typeof path !== "string") {
        throw new Md3Error("INVALID_PATH", "Resource path is missing");
      }
      const document = await documents.readDocument(path);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: document.markdown,
            _meta: {
              sourceUrl: document.sourceUrl,
              updatedAt: document.updatedAt ?? null,
              carbonVersion: document.carbonVersion,
            },
          },
        ],
      };
    },
  );
}
