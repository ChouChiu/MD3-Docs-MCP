import { errorMessage } from "../errors/md3-error.js";

export function toolResult(value: Record<string, unknown>, text?: string) {
  const safeValue = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  return {
    content: [{ type: "text" as const, text: text ?? JSON.stringify(safeValue, null, 2) }],
    structuredContent: safeValue,
  };
}

export const jsonResult = toolResult;

export function toolError(error: unknown) {
  return {
    content: [{ type: "text" as const, text: errorMessage(error) }],
    isError: true,
  };
}
