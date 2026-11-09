import { TtlLruCache } from "../../shared/cache/ttl-lru-cache.js";
import { Md3Error } from "../../shared/errors/md3-error.js";
import { fetchText } from "../../shared/http/fetch-text.js";
import { humanize, slugify } from "../../shared/text/slug.js";
import { SEARCH_PAGE_LIMIT, SITE_ORIGIN } from "./constants.js";
import {
  buildDirectory,
  cleanSearchText,
  discoverMainScript,
  findRouteForPath,
  getCategory,
  normalizeAndValidatePath,
  parseDocumentData,
  parseSearchPageResponse,
  parseSiteIndexScript,
  parseSitemap,
  searchSection,
} from "./parsers/index.js";
import type {
  Category,
  DirectoryEntry,
  DocumentData,
  ResolvedDocument,
  SearchHit,
  SiteIndex,
} from "./types.js";

export interface Md3ClientOptions {
  fetcher?: typeof fetch;
  cache?: TtlLruCache;
}

export interface FetchedDocument {
  document: DocumentData;
  resolved: ResolvedDocument;
  carbonVersion: string;
}

export interface SearchPageResult {
  hits: SearchHit[];
  nextStart?: number;
  nextItemOffset?: number;
}

/** Read-only client for the live Material 3 site, with a shared in-process cache. */
export class Md3Client {
  readonly #fetcher: typeof fetch;
  readonly #cache: TtlLruCache;

  constructor(options: Md3ClientOptions = {}) {
    this.#fetcher = options.fetcher ?? fetch;
    this.#cache = options.cache ?? new TtlLruCache();
  }

  async getSiteIndex(): Promise<SiteIndex> {
    return this.#cache.getOrLoad("site-index", async () => {
      const home = await fetchText(`${SITE_ORIGIN}/`, {}, this.#fetcher);
      const mainScriptUrl = discoverMainScript(home);
      const script = await fetchText(mainScriptUrl, {}, this.#fetcher);
      return { ...parseSiteIndexScript(script), mainScriptUrl };
    });
  }

  async getDirectory(): Promise<DirectoryEntry[]> {
    return this.#cache.getOrLoad("directory", async () => {
      const [xml, index] = await Promise.all([
        fetchText(`${SITE_ORIGIN}/sitemap.xml`, {}, this.#fetcher),
        this.getSiteIndex(),
      ]);
      return buildDirectory(parseSitemap(xml), index.routes);
    });
  }

  /**
   * Search upstream, walking at most {@link SEARCH_PAGE_LIMIT} pages to fill `limit`.
   *
   * Cursors resume inside one upstream page (`itemOffset`) or at the next upstream page
   * (`start`), so a caller can page through results one hit at a time.
   */
  async search(
    query: string,
    category: Category | undefined,
    start = 1,
    limit = 10,
    itemOffset = 0,
  ): Promise<SearchPageResult> {
    const key = `search:${query}:${category ?? "*"}:${start}:${itemOffset}:${limit}`;
    return this.#cache.getOrLoad(key, async () => {
      const hits: SearchHit[] = [];
      const seenPaths = new Set<string>();
      let upstreamStart = start;

      for (let page = 0; page < SEARCH_PAGE_LIMIT && hits.length < limit; page += 1) {
        const url = new URL(`${SITE_ORIGIN}/search_api`);
        url.searchParams.set("q", query);
        url.searchParams.set("start", String(upstreamStart));
        const response = parseSearchPageResponse(await fetchText(url.href, {}, this.#fetcher));
        const currentOffset = page === 0 ? itemOffset : 0;
        if (currentOffset > response.items.length) {
          throw new Md3Error("CURSOR_STALE", "Search results changed since this cursor was issued");
        }

        for (let index = currentOffset; index < response.items.length; index += 1) {
          const item = response.items[index];
          if (!item?.link) continue;
          const path = toDocumentPath(item.link);
          if (!path || seenPaths.has(path)) continue;
          seenPaths.add(path);
          const hitCategory = getCategory(path);
          if (category && hitCategory !== category) continue;
          const section = searchSection(path);
          hits.push({
            title: cleanSearchText(item.title ?? humanize(path.split("/").at(-1) ?? path)),
            snippet: cleanSearchText(item.snippet ?? ""),
            path,
            url: `${SITE_ORIGIN}/${path}`,
            category: hitCategory,
            ...(section ? { section } : {}),
          });
          if (hits.length === limit) {
            const moreInPage = index + 1 < response.items.length;
            return {
              hits,
              ...(moreInPage
                ? { nextStart: upstreamStart, nextItemOffset: index + 1 }
                : response.nextStart
                  ? { nextStart: response.nextStart, nextItemOffset: 0 }
                  : {}),
            };
          }
        }
        if (!response.nextStart) return { hits };
        upstreamStart = response.nextStart;
      }
      // The page budget ran out before the requested count; let the caller continue.
      return { hits, nextStart: upstreamStart, nextItemOffset: 0 };
    });
  }

  /** Resolve a user path to its owning route, canonical path, and document tab. */
  async resolveDocument(
    input: string,
    requestedSection?: string,
    index?: SiteIndex,
  ): Promise<ResolvedDocument> {
    const path = normalizeAndValidatePath(input);
    const siteIndex = index ?? (await this.getSiteIndex());
    const route = findRouteForPath(path, siteIndex.routes);
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

    return {
      route,
      canonicalPath: section ? `${route.path}/${slugify(section)}` : route.path,
      ...(section ? { section } : {}),
    };
  }

  async getDocument(input: string, requestedSection?: string): Promise<FetchedDocument> {
    // Validate before any network work so a bad path never depends on upstream reachability.
    const path = normalizeAndValidatePath(input);
    const index = await this.getSiteIndex();
    const resolved = await this.resolveDocument(path, requestedSection, index);
    const key = `document:${index.carbonVersion}:${resolved.route.documentId}`;
    const document = await this.#cache.getOrLoad(key, async () => {
      const url = `${SITE_ORIGIN}/_dsm/content/m3/${encodeURIComponent(index.carbonVersion)}/${encodeURIComponent(resolved.route.documentId)}`;
      return parseDocumentData(await fetchText(url, {}, this.#fetcher));
    });
    return { document, resolved, carbonVersion: index.carbonVersion };
  }

  /** Load one `designSystems/...` resource table referenced by a content chunk. */
  async loadResourceData(version: string, name: string): Promise<unknown> {
    if (!/^designSystems\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)+$/.test(name)) {
      throw new Md3Error("UPSTREAM_SCHEMA", "Invalid resource data name");
    }
    const filename = `${name.replaceAll("/", "_")}.json`;
    const url = `${SITE_ORIGIN}/_dsm/data/dsdb-m3/${encodeURIComponent(version)}/${filename}`;
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

/** Search hits may carry absolute, same-origin URLs or bare canonical paths. */
function toDocumentPath(link: string): string | undefined {
  try {
    return normalizeAndValidatePath(link);
  } catch {
    return undefined;
  }
}
