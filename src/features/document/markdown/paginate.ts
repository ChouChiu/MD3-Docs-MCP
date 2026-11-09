import type { DocumentPage, RenderedDocument } from "../types.js";
import { blockMarkdown } from "./blocks.js";
import { splitMarkdownSafely } from "./split.js";

interface PageUnit {
  text: string;
  blockIndex: number;
}

/**
 * Page an already-selected document on semantic boundaries.
 *
 * Each unit is a heading-prefixed fragment that is itself within budget, so a page breaks
 * between blocks or paragraphs and never inside a table or fenced code block.
 */
export function paginateDocument(
  document: RenderedDocument,
  maxCharacters: number,
): DocumentPage[] {
  const pageHeader = `# ${document.title}`;
  const available = Math.max(100, maxCharacters - pageHeader.length - 2);

  const descriptionUnits: PageUnit[] = document.description
    ? splitMarkdownSafely(document.description, available).map((text) => ({ text, blockIndex: 0 }))
    : [];

  let globalBlockIndex = 0;
  const blockUnits = document.sections.flatMap((section) => {
    return section.blocks.flatMap((block) => {
      const blockIndex = globalBlockIndex;
      globalBlockIndex += 1;
      const prefix = [
        `## ${section.name}`,
        ...(block.heading ? [`### ${block.heading}`] : []),
      ].join("\n\n");
      const contentLimit = Math.max(100, available - prefix.length - 2);
      const content = blockMarkdown(block);
      const fragments = content ? splitMarkdownSafely(content, contentLimit) : [""];
      return fragments.map((fragment) => ({
        text: fragment ? `${prefix}\n\n${fragment}` : prefix,
        blockIndex,
      }));
    });
  });

  const units = [...descriptionUnits, ...blockUnits];
  if (units.length === 0) {
    return [{ markdown: pageHeader.slice(0, maxCharacters), startBlock: 0, endBlock: 0 }];
  }

  const pages: DocumentPage[] = [];
  let body = "";
  let startBlock = units[0]?.blockIndex ?? 0;
  let endBlock = startBlock;
  for (const unit of units) {
    const combined = body ? `${body}\n\n${unit.text}` : unit.text;
    if (body && `${pageHeader}\n\n${combined}`.length > maxCharacters) {
      pages.push({ markdown: `${pageHeader}\n\n${body}`, startBlock, endBlock });
      body = unit.text;
      startBlock = unit.blockIndex;
    } else {
      body = combined;
    }
    endBlock = unit.blockIndex;
  }
  if (body) pages.push({ markdown: `${pageHeader}\n\n${body}`, startBlock, endBlock });
  return pages;
}
