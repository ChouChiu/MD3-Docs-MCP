import { z } from "zod/v4";
import { Md3Error } from "../../../shared/errors/md3-error.js";
import { humanize } from "../../../shared/text/slug.js";

const COMMON_SECTION_SLUGS = new Set(["overview", "specs", "guidelines", "accessibility"]);

/**
 * The search endpoint is a Search-service response. Current builds nest each result under
 * `document.derived_struct_data`; older builds returned flat `title`/`link`/`snippet`.
 * Both shapes are accepted so a deploy on either side keeps working.
 */
const derivedDataSchema = z.object({
  title: z.string().optional(),
  link: z.string().optional(),
  formattedUrl: z.string().optional(),
  snippets: z.array(z.object({ snippet: z.string().optional() })).optional(),
  pagemap: z
    .object({
      metatags: z.array(z.record(z.string(), z.unknown())).optional(),
    })
    .optional(),
});

const searchItemSchema = z.object({
  title: z.string().optional(),
  link: z.string().optional(),
  snippet: z.string().optional(),
  document: z.object({ derived_struct_data: derivedDataSchema.optional() }).optional(),
});

const searchResponseSchema = z
  .object({
    items: z.array(searchItemSchema).optional(),
    queries: z
      .object({
        nextPage: z
          .array(z.object({ startIndex: z.number().int().positive().optional() }))
          .optional(),
      })
      .optional(),
  })
  .refine((value) => value.items !== undefined || value.queries !== undefined);

export interface SearchPageItem {
  title: string | undefined;
  link: string | undefined;
  snippet: string | undefined;
}

export interface SearchPage {
  items: SearchPageItem[];
  nextStart: number | undefined;
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

/** Normalize one upstream search payload into flat results. */
export function parseSearchPageResponse(text: string): SearchPage {
  let response: z.infer<typeof searchResponseSchema>;
  try {
    response = searchResponseSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new Md3Error("UPSTREAM_SCHEMA", "Invalid Material 3 search response", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const items = (response.items ?? []).map((raw) => {
    const derived = raw.document?.derived_struct_data;
    const metatags = derived?.pagemap?.metatags?.[0];
    return {
      title: firstText(derived?.title, raw.title),
      link: firstText(
        derived?.link,
        derived?.formattedUrl,
        raw.link,
        metatags?.["og:url"],
        metatags?.["twitter:url"],
      ),
      snippet: firstText(derived?.snippets?.[0]?.snippet, raw.snippet),
    };
  });
  return {
    items,
    nextStart: response.queries?.nextPage?.[0]?.startIndex,
  };
}

/** Strip markup and site chrome from a search title or snippet. */
export function cleanSearchText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\b(?:link\s+)?copy link\s*link copied\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Human label for a tab-style path suffix, when the suffix names a known tab. */
export function searchSection(path: string): string | undefined {
  const slug = path.split("/").at(-1);
  return slug && COMMON_SECTION_SLUGS.has(slug) ? humanize(slug) : undefined;
}
