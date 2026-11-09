import { errorMessage } from "../errors/md3-error.js";

/**
 * Successful tool payload: structured data plus its Markdown/text rendering.
 *
 * The text fallback is minified on purpose - pretty-printed JSON spends roughly 45%
 * of its bytes on indentation and newlines that a reader never needs.
 */
export function toolResult(value: Record<string, unknown>, text?: string) {
  return {
    content: [{ type: "text" as const, text: text ?? JSON.stringify(value) }],
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
