export type Md3ErrorCode =
  | "INVALID_PATH"
  | "NOT_FOUND"
  | "UPSTREAM_HTTP"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_SCHEMA"
  | "CURSOR_INVALID"
  | "CURSOR_STALE";

export class Md3Error extends Error {
  readonly code: Md3ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: Md3ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "Md3Error";
    this.code = code;
    this.details = details;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Md3Error) {
    return JSON.stringify({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return JSON.stringify({ error: { code: "INTERNAL", message } });
}
