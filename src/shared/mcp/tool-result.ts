import { errorMessage } from "../errors/md3-error.js";

/** Successful tool payload: structured data plus its Markdown/text rendering. */
export function toolResult(value: Record<string, unknown>, text?: string) {
  return {
    content: [{ type: "text" as const, text: text ?? JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

/** Failed tool payload: one stable, machine-readable error object. */
export function toolError(error: unknown) {
  return {
    content: [{ type: "text" as const, text: errorMessage(error) }],
    isError: true,
  };
}
