import { Md3Error } from "../../../shared/errors/md3-error.js";
import { SITE_ORIGIN } from "../constants.js";
import type { RouteEntry } from "../types.js";
import { isAllowedPath, normalizeLoosePath } from "./paths.js";

/** Locate the Angular main bundle that carries the live route and content-version data. */
export function discoverMainScript(homeHtml: string): string {
  const match = homeHtml.match(
    /<script[^>]+src=["']([^"']*\/static\/angular\/main\.[^"']+\.js)["']/i,
  );
  if (!match?.[1]) {
    throw new Md3Error("UPSTREAM_SCHEMA", "Could not discover the Material 3 main script");
  }
  const scriptUrl = new URL(match[1], SITE_ORIGIN);
  if (scriptUrl.origin !== SITE_ORIGIN || scriptUrl.username || scriptUrl.password) {
    throw new Md3Error("UPSTREAM_SCHEMA", "Material 3 main script must be same-origin");
  }
  return scriptUrl.href;
}

/**
 * Read every JavaScript object literal that follows a marker in the main bundle.
 *
 * The bundle is not valid JSON, so each candidate object is brace-matched (respecting
 * string escapes) and handed to JSON.parse; objects that are not JSON are skipped because
 * the same marker can appear in unrelated code.
 */
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
      // Unrelated JavaScript objects may share the marker; ignore them.
    }
    position = Math.max(end, position + marker.length);
  }
  return results;
}

function tabLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const labels = value.flatMap((tab) => {
    const label = (tab as { label?: unknown } | null)?.label;
    return typeof label === "string" ? [label] : [];
  });
  return [...new Set(labels)];
}

function metadataTitle(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.replace(/\s+[–—-]\s+Material Design 3?$/i, "").trim() || undefined;
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
    if (!isAllowedPath(path)) continue;
    routes.set(path, {
      path,
      documentId: item.exportedCarbonFileId,
      tabs: tabLabels(item.tabs),
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
    const title = metadataTitle(metadata?.share_title);
    const description = typeof item.description === "string" ? item.description : undefined;
    routes.set(route.path, {
      ...route,
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
    });
  }

  if (routes.size === 0) {
    throw new Md3Error("UPSTREAM_SCHEMA", "No Material 3 document routes were found");
  }
  return { carbonVersion: version, routes };
}
