import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { CATEGORIES, type Md3Client } from "../../infrastructure/material/index.js";
import { Md3Error } from "../../shared/errors/md3-error.js";
import { toolError, toolResult } from "../../shared/mcp/tool-result.js";
import { decodeCursor, encodeCursor } from "../../shared/pagination/cursor.js";

const browseOutputSchema = z.object({
  entries: z.array(
    z.object({
      title: z.string(),
      path: z.string(),
      category: z.enum(CATEGORIES),
      sections: z.array(z.string()),
      description: z.string().optional(),
      updatedAt: z.string().optional(),
      sourceUrl: z.string().url(),
    }),
  ),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().optional(),
});

export function registerBrowseFeature(server: McpServer, client: Md3Client): void {
  server.registerTool(
    "browse_md3_docs",
    {
      title: "Browse Material Design 3 documentation",
      description:
        "Browse the official MD3 directory by category or canonical path prefix. Use search_md3_docs for natural-language discovery.",
      inputSchema: z.object({
        category: z.enum(CATEGORIES).optional(),
        prefix: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        cursor: z.string().max(2048).optional(),
      }),
      outputSchema: browseOutputSchema,
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
        const entries = filtered.slice(offset, offset + limit).map((entry) => ({
          title: entry.title,
          path: entry.path,
          category: entry.category,
          sections: entry.tabs,
          ...(entry.description ? { description: entry.description } : {}),
          ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {}),
          sourceUrl: entry.url,
        }));
        const nextOffset = offset + entries.length;
        return toolResult({
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
