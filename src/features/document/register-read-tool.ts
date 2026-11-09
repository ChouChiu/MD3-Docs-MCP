import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { Md3Error } from "../../shared/errors/md3-error.js";
import { toolError, toolResult } from "../../shared/mcp/tool-result.js";
import { decodeCursor, encodeCursor } from "../../shared/pagination/cursor.js";
import type { DocumentService } from "./document-service.js";
import { paginateDocument } from "./markdown/index.js";

const readOutputSchema = z.object({
  title: z.string(),
  path: z.string(),
  sourceUrl: z.string().url(),
  section: z.string().optional(),
  updatedAt: z.string().optional(),
  contentVersion: z.string(),
  availableSections: z.array(z.string()).optional(),
  availableHeadings: z.array(z.string()).optional(),
  markdown: z.string(),
  contentRange: z.object({
    page: z.number().int().nonnegative(),
    totalPages: z.number().int().positive(),
    startBlock: z.number().int().nonnegative(),
    endBlock: z.number().int().nonnegative(),
  }),
  truncated: z.boolean(),
  nextCursor: z.string().optional(),
});

export function registerDocumentFeature(server: McpServer, documents: DocumentService): void {
  server.registerTool(
    "read_md3_doc",
    {
      title: "Read Material Design 3 documentation",
      description:
        "Read one official MD3 document or section as intact semantic Markdown. Use heading to focus a subsection and nextCursor to continue without broken tables or code fences. Set includeOutline on a continuation page to get the document outline again.",
      inputSchema: z.object({
        path: z.string().trim().min(1).max(500),
        section: z.string().trim().min(1).max(100).optional(),
        heading: z.string().trim().min(1).max(200).optional(),
        maxCharacters: z.number().int().min(1_000).max(30_000).default(8_000),
        cursor: z.string().max(4096).optional(),
        includeOutline: z.boolean().default(false),
      }),
      outputSchema: readOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ path, section, heading, maxCharacters, cursor, includeOutline }) => {
      try {
        const document = await documents.readDocument(path, section, heading);
        let page = 0;
        if (cursor) {
          const decoded = decodeCursor(cursor, "read");
          if (decoded.version !== document.carbonVersion) {
            throw new Md3Error("CURSOR_STALE", "Document changed since this cursor was issued");
          }
          if (
            decoded.path !== document.canonicalPath ||
            decoded.section !== document.section ||
            decoded.heading !== heading ||
            decoded.maxCharacters !== maxCharacters
          ) {
            throw new Md3Error("CURSOR_INVALID", "Read cursor does not match the request");
          }
          page = decoded.page;
        }
        const pages = paginateDocument(document, maxCharacters);
        const selected = pages[page];
        if (!selected) {
          throw new Md3Error("CURSOR_INVALID", "Read cursor points beyond the document");
        }
        const nextPage = page + 1;
        const value = {
          title: document.title,
          path: document.canonicalPath,
          sourceUrl: document.sourceUrl,
          ...(document.section ? { section: document.section } : {}),
          ...(document.updatedAt ? { updatedAt: document.updatedAt } : {}),
          contentVersion: document.carbonVersion,
          // The outline is orientation for the first page only; a continuation page carries
          // it again just when the caller asks, instead of on every page by default.
          ...(page === 0 || includeOutline
            ? {
                availableSections: document.availableSections,
                availableHeadings: document.availableHeadings,
              }
            : {}),
          markdown: selected.markdown,
          contentRange: {
            page,
            totalPages: pages.length,
            startBlock: selected.startBlock,
            endBlock: selected.endBlock,
          },
          truncated: nextPage < pages.length,
          ...(nextPage < pages.length
            ? {
                nextCursor: encodeCursor({
                  kind: "read" as const,
                  page: nextPage,
                  path: document.canonicalPath,
                  ...(document.section ? { section: document.section } : {}),
                  ...(heading ? { heading } : {}),
                  version: document.carbonVersion,
                  maxCharacters,
                }),
              }
            : {}),
        };
        return toolResult(value, selected.markdown);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
