import assert from "node:assert/strict";
import test from "node:test";
import { fetchText } from "../../../src/shared/http/fetch-text.js";

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
