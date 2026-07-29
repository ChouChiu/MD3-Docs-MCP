import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { CATEGORIES, type Md3Client } from "../../infrastructure/material/index.js";
import { toolError, toolResult } from "../../shared/mcp/tool-result.js";
import type { DocumentService } from "../document/index.js";
import { ContextService } from "./context-service.js";

const contextModeSchema = z.enum(["implementation", "review", "research"]);

const contextOutputSchema = z.object({
  task: z.string(),
  mode: contextModeSchema,
  markdown: z.string(),
  sources: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      path: z.string(),
      section: z.string().optional(),
      sourceUrl: z.string().url(),
      updatedAt: z.string().optional(),
    }),
  ),
  checklist: z.array(
    z.object({
      criterion: z.string(),
      sourceId: z.string(),
      sourceUrl: z.string().url(),
    }),
  ),
  warnings: z.array(z.string()),
  truncated: z.boolean(),
});

export function registerContextFeature(
  server: McpServer,
  client: Md3Client,
  documents: DocumentService,
): void {
  const contexts = new ContextService(client, documents);
  server.registerTool(
    "get_md3_context",
    {
      title: "Get task-focused Material Design 3 context",
      description:
        "Gather several official MD3 sources into one cited context package. Choose implementation for building UI, review for evidence-backed checks, or research for general questions.",
      inputSchema: z.object({
        task: z.string().trim().min(1).max(500),
        mode: contextModeSchema.default("research"),
        paths: z.array(z.string().trim().min(1).max(500)).max(5).default([]),
        category: z.enum(CATEGORIES).optional(),
        maxSources: z.number().int().min(1).max(8).default(5),
        maxCharacters: z.number().int().min(4_000).max(40_000).default(20_000),
      }),
      outputSchema: contextOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ task, mode, paths, category, maxSources, maxCharacters }) => {
      try {
        const result = await contexts.getContext({
          task,
          mode,
          paths,
          ...(category ? { category } : {}),
          maxSources,
          maxCharacters,
        });
        return toolResult({ ...result }, result.markdown);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}
