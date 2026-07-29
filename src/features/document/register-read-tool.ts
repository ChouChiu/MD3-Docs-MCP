import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { Md3Error } from "../../shared/errors/md3-error.js";
import { jsonResult, TOOL_OUTPUT_SCHEMA, toolError } from "../../shared/mcp/tool-result.js";
import { decodeCursor, encodeCursor } from "../../shared/pagination/cursor.js";
import type { DocumentService } from "./document-service.js";

export function registerDocumentFeature(server: McpServer, documents: DocumentService): void {
  server.registerTool(
    "read_md3_doc",
    {
      title: "Read Material Design 3 documentation",
      description:
        "Read a live Material Design 3 document as English Markdown, with section selection and cursor pagination.",
      inputSchema: z.object({
        path: z.string().trim().min(1).max(500),
        section: z.string().trim().min(1).max(100).optional(),
        maxCharacters: z.number().int().min(1_000).max(30_000).default(12_000),
        cursor: z.string().max(4096).optional(),
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ path, section, maxCharacters, cursor }) => {
      try {
        const document = await documents.readDocument(path, section);
        let offset = 0;
        if (cursor) {
          const decoded = decodeCursor(cursor, "read");
          if (decoded.version !== document.carbonVersion) {
            throw new Md3Error("CURSOR_STALE", "Document changed since this cursor was issued");
          }
          if (decoded.path !== document.canonicalPath || decoded.section !== document.section) {
            throw new Md3Error("CURSOR_INVALID", "Read cursor does not match the document");
          }
          offset = decoded.offset;
        }
        const markdown = document.markdown.slice(offset, offset + maxCharacters);
        const nextOffset = offset + markdown.length;
        return jsonResult({
          title: document.title,
          path: document.canonicalPath,
          sourceUrl: document.sourceUrl,
          ...(document.section ? { section: document.section } : {}),
          ...(document.updatedAt ? { updatedAt: document.updatedAt } : {}),
          availableSections: document.availableSections,
          markdown,
          media: document.media,
          offset,
          ...(nextOffset < document.markdown.length
            ? {
                nextCursor: encodeCursor({
                  kind: "read",
                  offset: nextOffset,
                  path: document.canonicalPath,
                  ...(document.section ? { section: document.section } : {}),
                  version: document.carbonVersion,
                }),
              }
            : {}),
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
