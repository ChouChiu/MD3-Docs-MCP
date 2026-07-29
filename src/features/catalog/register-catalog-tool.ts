import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { CATEGORIES, type Md3Client } from "../../infrastructure/material/index.js";
import { Md3Error } from "../../shared/errors/md3-error.js";
import { jsonResult, TOOL_OUTPUT_SCHEMA, toolError } from "../../shared/mcp/tool-result.js";
import { decodeCursor, encodeCursor } from "../../shared/pagination/cursor.js";

export function registerCatalogFeature(server: McpServer, client: Md3Client): void {
  server.registerTool(
    "list_md3_docs",
    {
      title: "List Material Design 3 documentation",
      description: "List live Material Design 3 Foundations, Styles, and Components documents.",
      inputSchema: z.object({
        category: z.enum(CATEGORIES).optional(),
        prefix: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().max(2048).optional(),
      }),
      outputSchema: TOOL_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ category, prefix, limit, cursor }) => {
      try {
        const directory = await client.getDirectory();
        const normalizedPrefix = prefix?.replace(/^\/+|\/+$/g, "").toLowerCase();
        const filtered = directory.filter(
          (entry) =>
            (!category || entry.category === category) &&
            (!normalizedPrefix || entry.path.toLowerCase().startsWith(normalizedPrefix)),
        );
        const fingerprint = createHash("sha256")
          .update(
            `${category ?? "*"}:${normalizedPrefix ?? "*"}:${filtered.map((item) => item.path).join("|")}`,
          )
          .digest("base64url")
          .slice(0, 16);
        let offset = 0;
        if (cursor) {
          const decoded = decodeCursor(cursor, "list");
          if (decoded.fingerprint !== fingerprint) {
            throw new Md3Error("CURSOR_STALE", "Directory cursor no longer matches this listing");
          }
          offset = decoded.offset;
        }
        const entries = filtered.slice(offset, offset + limit);
        const nextOffset = offset + entries.length;
        return jsonResult({
          entries,
          total: filtered.length,
          ...(nextOffset < filtered.length
            ? {
                nextCursor: encodeCursor({
                  kind: "list",
                  offset: nextOffset,
                  fingerprint,
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
