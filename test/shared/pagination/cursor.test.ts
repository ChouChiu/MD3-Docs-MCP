import assert from "node:assert/strict";
import test from "node:test";
import { decodeCursor, encodeCursor } from "../../../src/shared/pagination/cursor.js";

test("cursor round-trips valid data", () => {
  const cursor = encodeCursor({
    kind: "search",
    start: 11,
    itemOffset: 2,
    query: "buttons",
    category: "components",
  });

  assert.deepEqual(decodeCursor(cursor, "search"), {
    kind: "search",
    start: 11,
    itemOffset: 2,
    query: "buttons",
    category: "components",
  });
});

test("cursor rejects malformed fields and unexpected properties", () => {
  for (const value of [
    {
      kind: "read",
      page: "1",
      path: "components/buttons",
      version: "v1",
      maxCharacters: 12_000,
    },
    { kind: "list", offset: -1, fingerprint: "hash" },
    { kind: "search", start: 1, itemOffset: 0, query: "x", unexpected: true },
  ]) {
    const cursor = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    assert.throws(() => decodeCursor(cursor, value.kind as "read"), /cursor is invalid/i);
  }
});
