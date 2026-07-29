import { z } from "zod/v4";
import { errorMessage } from "../errors/md3-error.js";

export const TOOL_OUTPUT_SCHEMA = z.record(z.string(), z.unknown());

export function jsonResult(value: Record<string, unknown>) {
  const safeValue = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(safeValue, null, 2) }],
    structuredContent: safeValue,
  };
}

export function toolError(error: unknown) {
  return {
    content: [{ type: "text" as const, text: errorMessage(error) }],
    isError: true,
  };
}
