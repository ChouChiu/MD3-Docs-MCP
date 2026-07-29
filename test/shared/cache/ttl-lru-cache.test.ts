import assert from "node:assert/strict";
import test from "node:test";
import { TtlLruCache } from "../../../src/shared/cache/ttl-lru-cache.js";

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
