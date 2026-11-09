import type { SemanticBlock } from "../types.js";
import { joinMarkdown } from "./join.js";

/** Markdown body of one block, without its heading. */
export function blockMarkdown(block: SemanticBlock): string {
  return joinMarkdown(block.chunks.map((chunk) => chunk.markdown));
}
