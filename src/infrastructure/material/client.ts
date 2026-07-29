import { z } from "zod/v4";
import { TtlLruCache } from "../../shared/cache/ttl-lru-cache.js";
import { Md3Error } from "../../shared/errors/md3-error.js";
import { fetchText } from "../../shared/http/fetch-text.js";
import {
  buildDirectory,
  discoverMainScript,
  findRouteForPath,
  getCategory,
  humanize,
  normalizeAndValidatePath,
  parseDocumentData,
  parseSiteIndexScript,
  parseSitemap,
  slugify,
} from "./parsers.js";
import type {
  Category,
  DirectoryEntry,
  DocumentData,
  ResolvedDocument,
  SearchHit,
  SiteIndex,
} from "./types.js";

const BASE_URL = "https://m3.material.io";
const COMMON_SECTION_SLUGS = new Set(["overview", "specs", "guidelines", "accessibility"]);

function cleanSearchText(value: string): string {
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

function searchSection(path: string): string | undefined {
  const slug = path.split("/").at(-1);
  return slug && COMMON_SECTION_SLUGS.has(slug) ? humanize(slug) : undefined;
}

const searchResponseSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            title: z.string().optional(),
            link: z.string().optional(),
            snippet: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    queries: z
      .object({
        nextPage: z
          .array(
            z
              .object({
                startIndex: z.number().int().positive().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .refine((value) => value.items !== undefined || value.queries !== undefined);

export interface Md3ClientOptions {
  fetcher?: typeof fetch;
  cache?: TtlLruCache;
}

export interface FetchedDocument {
  document: DocumentData;
  resolved: ResolvedDocument;
  carbonVersion: string;
}

export class Md3Client {
  readonly #fetcher: typeof fetch;
  readonly #cache: TtlLruCache;

  constructor(options: Md3ClientOptions = {}) {
    this.#fetcher = options.fetcher ?? fetch;
    this.#cache = options.cache ?? new TtlLruCache();
  }

  async getSiteIndex(): Promise<SiteIndex> {
    return this.#cache.getOrLoad("site-index", async () => {
      const home = await fetchText(`${BASE_URL}/`, {}, this.#fetcher);
      const mainScriptUrl = discoverMainScript(home);
      const script = await fetchText(mainScriptUrl, {}, this.#fetcher);
      const parsed = parseSiteIndexScript(script);
      return { ...parsed, mainScriptUrl };
    });
  }

  async getDirectory(): Promise<DirectoryEntry[]> {
    return this.#cache.getOrLoad("directory", async () => {
      const [xml, index] = await Promise.all([
        fetchText(`${BASE_URL}/sitemap.xml`, {}, this.#fetcher),
        this.getSiteIndex(),
      ]);
      return buildDirectory(parseSitemap(xml), index.routes);
    });
  }

  async search(
    query: string,
    category: Category | undefined,
    start = 1,
    limit = 10,
    itemOffset = 0,
  ): Promise<{ hits: SearchHit[]; nextStart?: number; nextItemOffset?: number }> {
    const key = `search:${query}:${category ?? "*"}:${start}:${itemOffset}:${limit}`;
    return this.#cache.getOrLoad(key, async () => {
      const hits: SearchHit[] = [];
      const seenPaths = new Set<string>();
      let upstreamStart = start;
      let nextStart: number | undefined;
      let nextItemOffset: number | undefined;
      for (let page = 0; page < 5 && hits.length < limit; page += 1) {
        const url = new URL(`${BASE_URL}/search_api`);
        url.searchParams.set("q", query);
        url.searchParams.set("start", String(upstreamStart));
        const text = await fetchText(url.href, {}, this.#fetcher);
        let response: z.infer<typeof searchResponseSchema>;
        try {
          response = searchResponseSchema.parse(JSON.parse(text));
        } catch (error) {
          throw new Md3Error("UPSTREAM_SCHEMA", "Invalid Material 3 search response", {
            cause: error instanceof Error ? error.message : String(error),
          });
        }
        const items = response.items ?? [];
        const currentOffset = page === 0 ? itemOffset : 0;
        if (currentOffset > items.length) {
          throw new Md3Error("CURSOR_STALE", "Search results changed since this cursor was issued");
        }
        const upstreamNextStart = response.queries?.nextPage?.[0]?.startIndex;
        for (let index = currentOffset; index < items.length; index += 1) {
          const item = items[index];
          if (!item) continue;
          if (!item.link) continue;
          let path: string;
          try {
            path = normalizeAndValidatePath(item.link);
          } catch {
            continue;
          }
          if (seenPaths.has(path)) continue;
          seenPaths.add(path);
          const hitCategory = getCategory(path);
          if (category && hitCategory !== category) continue;
          const section = searchSection(path);
          hits.push({
            title: cleanSearchText(item.title ?? humanize(path.split("/").at(-1) ?? path)),
            snippet: cleanSearchText(item.snippet ?? ""),
            path,
            url: `${BASE_URL}/${path}`,
            category: hitCategory,
            ...(section ? { section } : {}),
          });
          if (hits.length === limit) {
            if (index + 1 < items.length) {
              nextStart = upstreamStart;
              nextItemOffset = index + 1;
            } else if (upstreamNextStart) {
              nextStart = upstreamNextStart;
              nextItemOffset = 0;
            } else {
              nextStart = undefined;
              nextItemOffset = undefined;
            }
            break;
          }
        }
        if (hits.length === limit) break;
        if (!upstreamNextStart) {
          nextStart = undefined;
          nextItemOffset = undefined;
          break;
        }
        nextStart = upstreamNextStart;
        nextItemOffset = 0;
        upstreamStart = upstreamNextStart;
      }
      return {
        hits,
        ...(nextStart
          ? { nextStart, ...(nextItemOffset !== undefined ? { nextItemOffset } : {}) }
          : {}),
      };
    });
  }

  async resolveDocument(input: string, requestedSection?: string): Promise<ResolvedDocument> {
    const path = normalizeAndValidatePath(input);
    const index = await this.getSiteIndex();
    const route = findRouteForPath(path, index.routes);
    if (!route) throw new Md3Error("NOT_FOUND", "Material 3 document was not found", { path });

    const suffix = path === route.path ? undefined : path.slice(route.path.length + 1);
    let section =
      (suffix ? route.tabs.find((tab) => slugify(tab) === suffix.toLowerCase()) : undefined) ??
      (route.tabs.some((tab) => slugify(tab) === "overview") ? "Overview" : undefined);
    if (requestedSection && route.tabs.length > 0) {
      const matched = route.tabs.find((tab) => slugify(tab) === slugify(requestedSection));
      if (!matched) {
        throw new Md3Error("NOT_FOUND", "Requested document section was not found", {
          section: requestedSection,
          availableSections: route.tabs,
        });
      }
      section = matched;
    } else if (requestedSection) {
      section = requestedSection;
    }
    const canonicalPath = section ? `${route.path}/${slugify(section)}` : route.path;
    return { route, canonicalPath, ...(section ? { section } : {}) };
  }

  async getDocument(input: string, requestedSection?: string): Promise<FetchedDocument> {
    const resolved = await this.resolveDocument(input, requestedSection);
    const index = await this.getSiteIndex();
    const key = `document:${index.carbonVersion}:${resolved.route.documentId}`;
    const document = await this.#cache.getOrLoad(key, async () => {
      const url = `${BASE_URL}/_dsm/content/m3/${encodeURIComponent(index.carbonVersion)}/${encodeURIComponent(resolved.route.documentId)}`;
      return parseDocumentData(await fetchText(url, {}, this.#fetcher)) as DocumentData;
    });
    return { document, resolved, carbonVersion: index.carbonVersion };
  }

  async loadResourceData(version: string, name: string): Promise<unknown> {
    if (!/^designSystems\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)+$/.test(name)) {
      throw new Md3Error("UPSTREAM_SCHEMA", "Invalid resource data name");
    }
    const filename = `${name.replaceAll("/", "_")}.json`;
    const url = `${BASE_URL}/_dsm/data/dsdb-m3/${encodeURIComponent(version)}/${filename}`;
    return this.#cache.getOrLoad(`resource:${version}:${name}`, async () => {
      const text = await fetchText(url, {}, this.#fetcher);
      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        throw new Md3Error("UPSTREAM_SCHEMA", "Invalid Material 3 resource response", {
          cause: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
}
