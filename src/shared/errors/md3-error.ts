export type Md3ErrorCode =
  | "INVALID_PATH"
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "UPSTREAM_HTTP"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_SCHEMA"
  | "CURSOR_INVALID"
  | "CURSOR_STALE";

export class Md3Error extends Error {
  readonly code: Md3ErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly retryable: boolean;

  constructor(
    code: Md3ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    retryable = code === "UPSTREAM_HTTP" || code === "UPSTREAM_TIMEOUT",
  ) {
    super(message);
    this.name = "Md3Error";
    this.code = code;
    this.details = details;
    this.retryable = retryable;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Md3Error) {
    return JSON.stringify({
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return JSON.stringify({ error: { code: "INTERNAL", message, retryable: false } });
}
