import { Md3Error } from "../errors/md3-error.js";
import { APP_VERSION } from "../version.js";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 1;
const MAX_RETRY_AFTER_MS = 10_000;
const BASE_RETRY_DELAY_MS = 100;

export interface FetchTextOptions {
  timeoutMs?: number;
  retries?: number;
}

/** `Retry-After` is either a delay in seconds or an HTTP date. */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(timestamp - Date.now(), 0) : undefined;
}

function retryDelayMs(retryAfter: unknown, attempt: number): number {
  if (typeof retryAfter === "number" && Number.isFinite(retryAfter)) {
    return Math.min(retryAfter, MAX_RETRY_AFTER_MS);
  }
  const exponential = BASE_RETRY_DELAY_MS * 2 ** attempt;
  return exponential + Math.floor(Math.random() * Math.max(25, exponential / 2));
}

function classify(error: unknown, url: string, timeoutMs: number, timedOut: boolean): Md3Error {
  if (error instanceof Md3Error) return error;
  if (timedOut) {
    return new Md3Error("UPSTREAM_TIMEOUT", "Upstream request timed out", { url, timeoutMs });
  }
  return new Md3Error("UPSTREAM_HTTP", "Upstream request failed", {
    url,
    cause: error instanceof Error ? error.message : String(error),
  });
}

async function requestText(
  url: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetcher(url, {
    headers: {
      accept: "application/json, text/plain, text/html, application/xml",
      "user-agent": `MD3-Docs-MCP/${APP_VERSION}`,
    },
    redirect: "error",
    signal,
  });
  if (response.ok) return response.text();
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
  throw new Md3Error(
    "UPSTREAM_HTTP",
    `Upstream returned HTTP ${response.status}`,
    {
      status: response.status,
      url,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    },
    RETRYABLE_STATUS.has(response.status),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read one upstream response as text, retrying transient failures once.
 *
 * Timeouts, network failures, HTTP 429, and selected 5xx responses are retried; other
 * statuses fail immediately so a bad path never costs a second request.
 */
export async function fetchText(
  url: string,
  options: FetchTextOptions = {},
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;

  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await requestText(url, fetcher, controller.signal);
    } catch (error) {
      const failure = classify(error, url, timeoutMs, controller.signal.aborted);
      clearTimeout(timer);
      if (!failure.retryable || attempt >= retries) throw failure;
      await sleep(retryDelayMs(failure.details?.retryAfterMs, attempt));
    } finally {
      clearTimeout(timer);
    }
  }
}
