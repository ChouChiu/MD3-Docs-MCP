import { XMLParser } from "fast-xml-parser";
import { z } from "zod/v4";
import { Md3Error } from "../../shared/errors/md3-error.js";
import { CATEGORIES, type Category, type DirectoryEntry, type RouteEntry } from "./types.js";

const BASE_URL = "https://m3.material.io";
const CATEGORY_SET = new Set<string>(CATEGORIES);

const contentChunkSchema = z
  .object({
    htmlValue: z.string().nullish(),
    footer: z.string().nullish(),
    imageUrl: z.string().nullish(),
    imageUrlFife: z.string().nullish(),
    imageWidth: z.number().nullish(),
    imageHeight: z.number().nullish(),
    altText: z.string().nullish(),
    videoUrl: z.string().nullish(),
    videoWidth: z.number().nullish(),
    videoHeight: z.number().nullish(),
    prototypeUrl: z.string().nullish(),
    codeUrl: z.string().nullish(),
    linkUrl: z.string().nullish(),
    snippetCode: z.string().nullish(),
    snippetLanguage: z.string().nullish(),
    resourceName: z.string().nullish(),
    libraryModuleType: z.string().nullish(),
    contentChunkType: z.string().nullish(),
  })
  .passthrough();

const contentBlockSchema = z
  .object({
    title: z.string().nullish(),
    isHidden: z.boolean().optional(),
    contentChunks: z.array(contentChunkSchema).optional(),
  })
  .passthrough();

const contentSectionSchema = z
  .object({
    name: z.string().nullish(),
    isVisible: z.boolean().optional(),
    contentBlocks: z.array(contentBlockSchema).optional(),
  })
  .passthrough();

const documentSchema = z
  .object({
    title: z.string(),
    description: z.string().nullish(),
    updatedTimestamp: z.string().nullish(),
    sections: z.array(contentSectionSchema),
  })
  .passthrough();

export function discoverMainScript(homeHtml: string): string {
  const match = homeHtml.match(
    /<script[^>]+src=["']([^"']*\/static\/angular\/main\.[^"']+\.js)["']/i,
  );
  if (!match?.[1]) {
    throw new Md3Error("UPSTREAM_SCHEMA", "Could not discover the Material 3 main script");
  }
  const scriptUrl = new URL(match[1], BASE_URL);
  if (scriptUrl.origin !== BASE_URL || scriptUrl.username || scriptUrl.password) {
    throw new Md3Error("UPSTREAM_SCHEMA", "Material 3 main script must be same-origin");
  }
  return scriptUrl.href;
}

function extractJsonObjects(script: string, marker: string): unknown[] {
  const results: unknown[] = [];
  let position = 0;
  while (position < script.length) {
    position = script.indexOf(marker, position);
    if (position < 0) break;
    const start = script.lastIndexOf("{", position);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let index = start; index < script.length; index += 1) {
      const character = script[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    if (end < 0) break;
    try {
      results.push(JSON.parse(script.slice(start, end)));
    } catch {
      // Other JavaScript objects may surround the same marker; ignore them.
    }
    position = Math.max(end, position + marker.length);
  }
  return results;
}

export function parseSiteIndexScript(script: string): {
  carbonVersion: string;
  routes: Map<string, RouteEntry>;
} {
  const version = script.match(/carbonVersion:"([^"]+)"/)?.[1];
  if (!version) {
    throw new Md3Error("UPSTREAM_SCHEMA", "Could not find the Carbon content version");
  }

  const routes = new Map<string, RouteEntry>();
  for (const value of extractJsonObjects(script, '"exportedCarbonFileId"')) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    if (typeof item.slug !== "string" || typeof item.exportedCarbonFileId !== "string") continue;
    const path = normalizeLoosePath(item.slug);
    const category = path.split("/")[0];
    if (!category || !CATEGORY_SET.has(category)) continue;
    const tabs = Array.isArray(item.tabs)
      ? item.tabs
          .map((tab) =>
            tab && typeof tab === "object" && typeof (tab as { label?: unknown }).label === "string"
              ? String((tab as { label: string }).label)
              : "",
          )
          .filter(Boolean)
      : [];
    routes.set(path, {
      path,
      documentId: item.exportedCarbonFileId,
      tabs,
    });
  }
  for (const value of extractJsonObjects(script, '"metadata"')) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    if (typeof item.slug !== "string") continue;
    const route = routes.get(normalizeLoosePath(item.slug));
    if (!route) continue;
    const metadata =
      item.metadata && typeof item.metadata === "object"
        ? (item.metadata as Record<string, unknown>)
        : undefined;
    const title = typeof metadata?.share_title === "string" ? metadata.share_title : undefined;
    const description = typeof item.description === "string" ? item.description : undefined;
    routes.set(route.path, {
      ...route,
      ...(title ? { title: title.replace(/\s+[–—-]\s+Material Design 3?$/i, "") } : {}),
      ...(description ? { description } : {}),
    });
  }
  if (routes.size === 0) {
    throw new Md3Error("UPSTREAM_SCHEMA", "No Material 3 document routes were found");
  }
  return { carbonVersion: version, routes };
}

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseSitemap(xml: string): Map<string, string | undefined> {
  let parsed: unknown;
  try {
    parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true }).parse(xml);
  } catch (error) {
    throw new Md3Error("UPSTREAM_SCHEMA", "Invalid Material 3 sitemap XML", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const root = parsed as { urlset?: { url?: Array<{ loc?: string; lastmod?: string }> } };
  if (!root.urlset || typeof root.urlset !== "object") {
    throw new Md3Error("UPSTREAM_SCHEMA", "Material 3 sitemap is missing its URL set");
  }
  const entries = new Map<string, string | undefined>();
  for (const item of arrayify(root.urlset?.url)) {
    if (typeof item?.loc !== "string") continue;
    try {
      const url = new URL(item.loc);
      if (url.origin !== BASE_URL) continue;
      const path = normalizeLoosePath(url.pathname);
      if (isAllowedPath(path)) entries.set(path, item.lastmod);
    } catch {
      // Ignore malformed upstream entries.
    }
  }
  if (entries.size === 0) {
    throw new Md3Error("UPSTREAM_SCHEMA", "Material 3 sitemap contains no supported documents");
  }
  return entries;
}

export function parseDocumentData(input: string): z.infer<typeof documentSchema> {
  try {
    return documentSchema.parse(JSON.parse(input));
  } catch (error) {
    throw new Md3Error("UPSTREAM_SCHEMA", "Invalid Material 3 document response", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

export function normalizeLoosePath(path: string): string {
  return path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .join("/");
}

export function normalizeAndValidatePath(value: string): string {
  let path: string;
  try {
    if (/^https?:/i.test(value)) {
      const url = new URL(value);
      if (url.origin !== BASE_URL || url.username || url.password || url.search || url.hash) {
        throw new Md3Error("INVALID_PATH", "Only clean m3.material.io document URLs are allowed");
      }
      path = decodeURIComponent(url.pathname);
    } else {
      path = decodeURIComponent(value);
    }
  } catch (error) {
    if (error instanceof Md3Error) throw error;
    throw new Md3Error("INVALID_PATH", "The document path is malformed");
  }
  const normalized = normalizeLoosePath(path);
  if (
    path.includes("\\") ||
    normalized.split("/").some((segment) => segment === "." || segment === "..") ||
    !isAllowedPath(normalized)
  ) {
    throw new Md3Error("INVALID_PATH", "Path must be within foundations, styles, or components");
  }
  return normalized;
}

export function isAllowedPath(path: string): boolean {
  const category = path.split("/")[0];
  return Boolean(category && CATEGORY_SET.has(category));
}

export function getCategory(path: string): Category {
  const category = path.split("/")[0];
  if (!category || !CATEGORY_SET.has(category)) {
    throw new Md3Error("INVALID_PATH", "Unsupported Material 3 category");
  }
  return category as Category;
}

export function buildDirectory(
  sitemap: Map<string, string | undefined>,
  routes: Map<string, RouteEntry>,
): DirectoryEntry[] {
  const entries: DirectoryEntry[] = [];
  for (const [path, updatedAt] of sitemap) {
    const route = findRouteForPath(path, routes);
    if (!route) continue;
    const tab = path === route.path ? undefined : path.slice(route.path.length + 1);
    const title = route.title ?? humanize(route.path.split("/").at(-1) ?? route.path);
    entries.push({
      category: getCategory(path),
      path,
      url: `${BASE_URL}/${path}`,
      title: tab ? `${title} — ${humanize(tab)}` : title,
      ...(route.description ? { description: route.description } : {}),
      tabs: route.tabs,
      ...(updatedAt ? { updatedAt } : {}),
    });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export function findRouteForPath(
  path: string,
  routes: Map<string, RouteEntry>,
): RouteEntry | undefined {
  const candidates = [...routes.values()]
    .filter((route) => path === route.path || path.startsWith(`${route.path}/`))
    .sort((left, right) => right.path.length - left.path.length);
  const route = candidates[0];
  if (!route) return undefined;
  const suffix = path === route.path ? "" : path.slice(route.path.length + 1);
  if (!suffix) return route;
  return route.tabs.some((tab) => slugify(tab) === suffix.toLowerCase()) ? route : undefined;
}

export function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

export function humanize(value: string): string {
  return value
    .split("-")
    .map((word) => (word ? `${word[0]?.toUpperCase()}${word.slice(1)}` : word))
    .join(" ");
}
