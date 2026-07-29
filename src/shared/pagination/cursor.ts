import { z } from "zod/v4";
import { Md3Error } from "../errors/md3-error.js";

interface ListCursor {
  kind: "list";
  offset: number;
  fingerprint: string;
}

interface SearchCursor {
  kind: "search";
  start: number;
  itemOffset: number;
  rankOffset: number;
  query: string;
  category?: string;
}

interface ReadCursor {
  kind: "read";
  page: number;
  path: string;
  section?: string;
  heading?: string;
  version: string;
  maxCharacters: number;
}

export type CursorData = ListCursor | SearchCursor | ReadCursor;

const cursorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("list"),
      offset: z.number().int().nonnegative(),
      fingerprint: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      kind: z.literal("search"),
      start: z.number().int().positive(),
      itemOffset: z.number().int().nonnegative(),
      rankOffset: z.number().int().nonnegative(),
      query: z.string().min(1).max(200),
      category: z.string().min(1).max(100).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("read"),
      page: z.number().int().nonnegative(),
      path: z.string().min(1).max(500),
      section: z.string().min(1).max(100).optional(),
      heading: z.string().min(1).max(200).optional(),
      version: z.string().min(1).max(200),
      maxCharacters: z.number().int().min(1_000).max(30_000),
    })
    .strict(),
]);

export function encodeCursor(cursor: CursorData): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor<T extends CursorData["kind"]>(
  cursor: string,
  kind: T,
): Extract<CursorData, { kind: T }> {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("Cursor encoding is invalid");
    const value = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    ) as CursorData;
    if (value.kind !== kind) throw new Error("Cursor kind does not match");
    return value as Extract<CursorData, { kind: T }>;
  } catch (error) {
    throw new Md3Error("CURSOR_INVALID", "The cursor is invalid", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
