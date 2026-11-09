import { XMLParser } from "fast-xml-parser";
import { Md3Error } from "../../../shared/errors/md3-error.js";
import { humanize, slugify } from "../../../shared/text/slug.js";
import { SITE_ORIGIN } from "../constants.js";
import type { DirectoryEntry, RouteEntry } from "../types.js";
import { getCategory, isAllowedPath, normalizeLoosePath } from "./paths.js";

interface SitemapUrl {
  loc?: string;
  lastmod?: string;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Returns sitemap paths mapped to their last modification date. */
export function parseSitemap(xml: string): Map<string, string | undefined> {
  let parsed: unknown;
  try {
    parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true }).parse(xml);
  } catch (error) {
    throw new Md3Error("UPSTREAM_SCHEMA", "Invalid Material 3 sitemap XML", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const urlset = (parsed as { urlset?: { url?: SitemapUrl[] } }).urlset;
  if (!urlset || typeof urlset !== "object") {
    throw new Md3Error("UPSTREAM_SCHEMA", "Material 3 sitemap is missing its URL set");
  }

  const entries = new Map<string, string | undefined>();
  for (const item of asArray(urlset.url)) {
    if (typeof item?.loc !== "string") continue;
    let url: URL;
    try {
      url = new URL(item.loc);
    } catch {
      // Malformed upstream entries are skipped rather than failing the whole sitemap.
      continue;
    }
    if (url.origin !== SITE_ORIGIN) continue;
    const path = normalizeLoosePath(url.pathname);
    if (isAllowedPath(path)) entries.set(path, item.lastmod);
  }
  if (entries.size === 0) {
    throw new Md3Error("UPSTREAM_SCHEMA", "Material 3 sitemap contains no supported documents");
  }
  return entries;
}

/** Deepest route that owns `path`, or undefined when the tab or route is unknown. */
export function findRouteForPath(
  path: string,
  routes: Map<string, RouteEntry>,
): RouteEntry | undefined {
  let owner: RouteEntry | undefined;
  for (const route of routes.values()) {
    if (path !== route.path && !path.startsWith(`${route.path}/`)) continue;
    if (!owner || route.path.length > owner.path.length) owner = route;
  }
  if (!owner) return undefined;
  const suffix = path === owner.path ? "" : path.slice(owner.path.length + 1);
  if (!suffix) return owner;
  return owner.tabs.some((tab) => slugify(tab) === suffix.toLowerCase()) ? owner : undefined;
}

/** Join sitemap pages with route metadata into the public directory listing. */
export function buildDirectory(
  sitemap: Map<string, string | undefined>,
  routes: Map<string, RouteEntry>,
): DirectoryEntry[] {
  const entries: DirectoryEntry[] = [];
  for (const [path, updatedAt] of sitemap) {
    const route = findRouteForPath(path, routes);
    if (!route) continue;
    const tab = path === route.path ? undefined : path.slice(route.path.length + 1);
    const title = route.title?.trim() || humanize(route.path.split("/").at(-1) ?? route.path);
    entries.push({
      category: getCategory(path),
      path,
      url: `${SITE_ORIGIN}/${path}`,
      title: tab ? `${title} — ${humanize(tab)}` : title,
      ...(route.description ? { description: route.description } : {}),
      tabs: route.tabs,
      ...(updatedAt ? { updatedAt } : {}),
    });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}
