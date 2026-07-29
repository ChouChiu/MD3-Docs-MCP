import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { CATEGORIES, type Md3Client } from "../../infrastructure/material/index.js";
import { Md3Error } from "../../shared/errors/md3-error.js";
import { jsonResult, TOOL_OUTPUT_SCHEMA, toolError } from "../../shared/mcp/tool-result.js";
import { decodeCursor, encodeCursor } from "../../shared/pagination/cursor.js";

export function registerSearchFeature(server: McpServer, client: Md3Client): void {
  server.registerTool(
    "search_md3_docs",
    {
      title: "Search Material Design 3 documentation",
      description:
        "Search the live Material Design 3 site, restricted to Foundations, Styles, and Components.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200),
        category: z.enum(CATEGORIES).optional(),
        limit: z.number().int().min(1).max(20).default(10),
        cursor: z.string().max(2048).optional(),
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, category, limit, cursor }) => {
      try {
        let start = 1;
        let itemOffset = 0;
        if (cursor) {
          const decoded = decodeCursor(cursor, "search");
          if (decoded.query !== query || decoded.category !== category) {
            throw new Md3Error("CURSOR_INVALID", "Search cursor does not match the query");
          }
          start = decoded.start;
          itemOffset = decoded.itemOffset;
        }
        const result = await client.search(query, category, start, limit, itemOffset);
        return jsonResult({
          hits: result.hits,
          ...(result.nextStart
            ? {
                nextCursor: encodeCursor({
                  kind: "search",
                  start: result.nextStart,
                  itemOffset: result.nextItemOffset ?? 0,
                  query,
                  ...(category ? { category } : {}),
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
