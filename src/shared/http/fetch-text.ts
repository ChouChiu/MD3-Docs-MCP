import { Md3Error } from "../errors/md3-error.js";
import { APP_VERSION } from "../version.js";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface FetchTextOptions {
  timeoutMs?: number;
  retries?: number;
}

function retryDelay(response: Response | undefined, attempt: number): number {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 10_000);
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) return Math.min(Math.max(timestamp - Date.now(), 0), 10_000);
  }
  const exponential = 100 * 2 ** attempt;
  return exponential + Math.floor(Math.random() * Math.max(25, exponential / 2));
}

export async function fetchText(
  url: string,
  options: FetchTextOptions = {},
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response | undefined;
    try {
      response = await fetcher(url, {
        headers: {
          accept: "application/json, text/plain, text/html, application/xml",
          "user-agent": `MD3-Docs-MCP/${APP_VERSION}`,
        },
        redirect: "error",
        signal: controller.signal,
      });
      if (response.ok) return await response.text();
      const error = new Md3Error("UPSTREAM_HTTP", `Upstream returned HTTP ${response.status}`, {
        status: response.status,
        url,
      });
      if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) throw error;
      lastError = error;
    } catch (error) {
      if (error instanceof Md3Error && error.code === "UPSTREAM_HTTP") {
        const status = error.details?.status;
        if (typeof status === "number" && !RETRYABLE_STATUS.has(status)) throw error;
        if (attempt === retries) throw error;
        lastError = error;
      } else if (controller.signal.aborted) {
        lastError = new Md3Error("UPSTREAM_TIMEOUT", "Upstream request timed out", {
          url,
          timeoutMs,
        });
        if (attempt === retries) throw lastError;
      } else {
        lastError = error;
        if (attempt === retries) {
          throw new Md3Error("UPSTREAM_HTTP", "Upstream request failed", {
            url,
            cause: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
  }
  throw lastError;
}
