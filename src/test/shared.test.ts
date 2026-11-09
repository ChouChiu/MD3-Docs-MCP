import assert from "node:assert/strict";
import test from "node:test";
import { mapConcurrent } from "../shared/async/map-concurrent.js";
import { TtlLruCache } from "../shared/cache/ttl-lru-cache.js";
import { fetchText } from "../shared/http/fetch-text.js";
import { decodeCursor, encodeCursor } from "../shared/pagination/cursor.js";

test("TTL cache coalesces concurrent loaders", async () => {
  const cache = new TtlLruCache(1_000, 10);
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await Promise.resolve();
    return "value";
  };
  const results = await Promise.all([
    cache.getOrLoad("same", loader),
    cache.getOrLoad("same", loader),
    cache.getOrLoad("same", loader),
  ]);
  assert.deepEqual(results, ["value", "value", "value"]);
  assert.equal(calls, 1);
});

test("TTL cache evicts least recently used entries", async () => {
  const cache = new TtlLruCache(1_000, 2);
  await cache.getOrLoad("a", async () => "a");
  await cache.getOrLoad("b", async () => "b");
  await cache.getOrLoad("a", async () => "new-a");
  await cache.getOrLoad("c", async () => "c");
  assert.equal(cache.size, 2);
  let calls = 0;
  await cache.getOrLoad("b", async () => {
    calls += 1;
    return "new-b";
  });
  assert.equal(calls, 1);
});

test("TTL cache reloads expired entries", async () => {
  const cache = new TtlLruCache(5, 2);
  let calls = 0;
  const load = async () => {
    calls += 1;
    return calls;
  };

  assert.equal(await cache.getOrLoad("value", load), 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(await cache.getOrLoad("value", load), 2);
});

test("TTL cache does not serve an expired value when refresh fails", async () => {
  const cache = new TtlLruCache(5, 2);
  await cache.getOrLoad("value", async () => "old");
  await new Promise((resolve) => setTimeout(resolve, 10));

  await assert.rejects(
    cache.getOrLoad("value", async () => {
      throw new Error("refresh failed");
    }),
    /refresh failed/,
  );
  assert.equal(await cache.getOrLoad("value", async () => "new"), "new");
});

test("HTTP client retries a retryable response once", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return calls === 1 ? new Response("busy", { status: 503 }) : new Response("ok");
  }) as typeof fetch;
  assert.equal(await fetchText("https://m3.material.io/test", {}, fetcher), "ok");
  assert.equal(calls, 2);
});

test("HTTP client does not retry a permanent response", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return new Response("missing", { status: 404 });
  }) as typeof fetch;
  await assert.rejects(fetchText("https://m3.material.io/test", {}, fetcher), /HTTP 404/);
  assert.equal(calls, 1);
});

test("HTTP client reports a timeout", async () => {
  const fetcher = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })) as typeof fetch;

  await assert.rejects(
    fetchText("https://m3.material.io/test", { retries: 0, timeoutMs: 5 }, fetcher),
    /timed out/,
  );
});

test("HTTP client retries a network failure once", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    if (calls === 1) throw new Error("connection reset");
    return new Response("ok");
  }) as typeof fetch;

  assert.equal(await fetchText("https://m3.material.io/test", {}, fetcher), "ok");
  assert.equal(calls, 2);
});

test("cursor round-trips valid data", () => {
  const cursor = encodeCursor({
    kind: "search",
    start: 11,
    itemOffset: 2,
    rankOffset: 12,
    query: "buttons",
    category: "components",
  });

  assert.deepEqual(decodeCursor(cursor, "search"), {
    kind: "search",
    start: 11,
    itemOffset: 2,
    rankOffset: 12,
    query: "buttons",
    category: "components",
  });
});

test("cursor rejects malformed, foreign, and unreadable payloads", () => {
  for (const value of [
    { kind: "read", page: "1", path: "components/buttons", version: "v1", maxCharacters: 12_000 },
    { kind: "list", offset: -1, fingerprint: "hash" },
    { kind: "search", start: 1, itemOffset: 0, rankOffset: 0, query: "x", unexpected: true },
  ]) {
    const cursor = Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
    assert.throws(() => decodeCursor(cursor, value.kind as "read"), /cursor is invalid/i);
  }

  const list = encodeCursor({ kind: "list", offset: 2, fingerprint: "fingerprint" });
  assert.throws(() => decodeCursor(list, "read"), /cursor is invalid/i);
  for (const value of ["", "not base64!", Buffer.from("[]", "utf8").toString("base64url")]) {
    assert.throws(() => decodeCursor(value, "list"), /cursor is invalid/i);
  }
});
test("concurrency helper preserves order and bounds active work", async () => {
  let active = 0;
  let maximumActive = 0;
  const results = await mapConcurrent([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return value * 2;
  });

  assert.deepEqual(results, [2, 4, 6, 8, 10]);
  assert.equal(maximumActive, 2);
  await assert.rejects(
    mapConcurrent([1], 0, async (value) => value),
    RangeError,
  );
});

test("TTL cache releases rejected in-flight loads", async () => {
  const cache = new TtlLruCache();
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 2));
    throw new Error("load failed");
  };

  await assert.rejects(cache.getOrLoad("value", loader), /load failed/);
  await assert.rejects(cache.getOrLoad("value", loader), /load failed/);
  assert.equal(calls, 2);
  assert.equal(await cache.getOrLoad("value", async () => "recovered"), "recovered");
});
