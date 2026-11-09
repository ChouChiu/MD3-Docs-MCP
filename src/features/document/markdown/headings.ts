import { normalizeHeading } from "../../../shared/text/slug.js";
import type { SemanticBlock, SemanticChunk, SemanticSection } from "../types.js";
import { closesFence, leadingFence, openFence } from "./fences.js";

/** Markdown rendering level of a block title; block titles sit below section headings. */
const BLOCK_HEADING_LEVEL = 3;

export { normalizeHeading };

export interface MarkdownHeading {
  level: number;
  title: string;
}

export function parseMarkdownHeading(line: string): MarkdownHeading | undefined {
  const match = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
  const marker = match?.[1];
  const title = match?.[2]?.trim();
  return marker && title ? { level: marker.length, title } : undefined;
}

/** Line number to heading, ignoring anything inside fenced code where `#` is literal. */
export function headingLines(lines: readonly string[]): Map<number, MarkdownHeading> {
  const headings = new Map<number, MarkdownHeading>();
  let fence: ReturnType<typeof openFence> | undefined;
  for (const [index, line] of lines.entries()) {
    const marker = leadingFence(line);
    if (marker) {
      if (!fence) {
        fence = openFence(marker);
        continue;
      }
      if (closesFence(line, fence)) {
        fence = undefined;
        continue;
      }
    }
    if (fence) continue;
    const heading = parseMarkdownHeading(line);
    if (heading) headings.set(index, heading);
  }
  return headings;
}

export function markdownHeadings(markdown: string): string[] {
  return [...headingLines(markdown.split("\n")).values()].map((heading) => heading.title);
}

/** Every heading a block exposes: its title plus headings inside its chunks. */
export function blockHeadings(block: SemanticBlock): string[] {
  const values = [
    ...(block.heading ? [block.heading] : []),
    ...block.chunks.flatMap((chunk) => markdownHeadings(chunk.markdown)),
  ];
  return [...new Set(values)];
}

export function includesHeading(headings: readonly string[], value: string): boolean {
  const target = normalizeHeading(value);
  return headings.some((heading) => normalizeHeading(heading) === target);
}

function joinTrimmed(lines: readonly string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start]?.trim()) start += 1;
  while (end > start && !lines[end - 1]?.trim()) end -= 1;
  return lines.slice(start, end).join("\n");
}

/**
 * Keep only the part of the document owned by `requestedHeading`.
 *
 * A heading owns everything up to the next heading of the same or a higher level, which
 * usually continues across several content blocks: on the live site a section's body is
 * split into blocks per paragraph group, so selection has to walk blocks until the next
 * peer heading instead of stopping at the first block boundary.
 */
export function selectHeading(
  sections: readonly SemanticSection[],
  requestedHeading: string,
): SemanticSection[] {
  const target = normalizeHeading(requestedHeading);
  const selected: SemanticSection[] = [];
  let found = false;
  let capturing = false;
  let captureLevel = 0;
  let finished = false;

  for (const section of sections) {
    const blocks: SemanticBlock[] = [];
    for (const block of section.blocks) {
      if (finished) break;

      let matchedBlockHeading = false;
      if (block.heading) {
        if (!capturing) {
          if (found || normalizeHeading(block.heading) !== target) continue;
          found = true;
          capturing = true;
          captureLevel = BLOCK_HEADING_LEVEL;
          matchedBlockHeading = true;
        } else if (BLOCK_HEADING_LEVEL <= captureLevel) {
          finished = true;
          break;
        }
      }

      const chunks: SemanticChunk[] = [];
      for (const chunk of block.chunks) {
        if (finished) break;
        const lines = chunk.markdown.split("\n");
        const headings = headingLines(lines);
        const kept: string[] = [];
        for (const [index, line] of lines.entries()) {
          const heading = headings.get(index);
          if (!capturing) {
            if (!found && heading && normalizeHeading(heading.title) === target) {
              found = true;
              capturing = true;
              captureLevel = heading.level;
              kept.push(line);
            }
            continue;
          }
          if (heading && heading.level <= captureLevel) {
            finished = true;
            break;
          }
          kept.push(line);
        }
        const markdown = joinTrimmed(kept);
        if (markdown) chunks.push({ ...chunk, markdown });
      }

      if (matchedBlockHeading || chunks.length > 0) blocks.push({ ...block, chunks });
    }
    if (blocks.length > 0) selected.push({ ...section, blocks });
    if (capturing) finished = true;
    if (finished) break;
  }

  return found ? selected : [];
}
