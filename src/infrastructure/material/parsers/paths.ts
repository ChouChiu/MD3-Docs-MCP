import { Md3Error } from "../../../shared/errors/md3-error.js";
import { SITE_ORIGIN } from "../constants.js";
import { CATEGORIES, type Category } from "../types.js";

const CATEGORY_SET = new Set<string>(CATEGORIES);

/** Collapse a raw path into bare slash-separated segments. */
export function normalizeLoosePath(path: string): string {
  return path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .join("/");
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

/**
 * Accepts a canonical path or a clean official URL and returns the canonical path.
 *
 * Tool input is untrusted, so off-origin URLs, credentials, query strings, fragments,
 * traversal segments, and non-document categories are rejected here rather than deeper in
 * the pipeline where a malformed path could be composed into an upstream request.
 */
export function normalizeAndValidatePath(value: string): string {
  let rawPath: string;
  try {
    if (/^https?:/i.test(value)) {
      const url = new URL(value);
      if (url.origin !== SITE_ORIGIN || url.username || url.password || url.search || url.hash) {
        throw new Md3Error("INVALID_PATH", "Only clean m3.material.io document URLs are allowed");
      }
      rawPath = url.pathname;
    } else {
      rawPath = value;
    }
    if (/%2f|%5c/i.test(rawPath)) {
      throw new Md3Error("INVALID_PATH", "Encoded path separators are not allowed");
    }
    const path = decodeURIComponent(rawPath);
    if (/%2f|%5c/i.test(path)) {
      throw new Md3Error("INVALID_PATH", "Encoded path separators are not allowed");
    }
    if (/\p{Cc}/u.test(path)) {
      throw new Md3Error("INVALID_PATH", "The document path contains control characters");
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
  } catch (error) {
    if (error instanceof Md3Error) throw error;
    throw new Md3Error("INVALID_PATH", "The document path is malformed");
  }
}
