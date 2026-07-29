import type { DocumentPage, RenderedDocument, SemanticBlock } from "./types.js";

function normalizeHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, " ");
}

function markdownHeadings(markdown: string): string[] {
  return markdown.split("\n").flatMap((line) => {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
    return match?.[1] ? [match[1].trim()] : [];
  });
}

export function blockHeadings(block: SemanticBlock): string[] {
  const values = [
    ...(block.heading ? [block.heading] : []),
    ...block.chunks.flatMap((chunk) => markdownHeadings(chunk.markdown)),
  ];
  return [...new Set(values)];
}

interface MarkdownHeading {
  level: number;
  title: string;
}

function parseMarkdownHeading(line: string): MarkdownHeading | undefined {
  const match = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
  const marker = match?.[1];
  const title = match?.[2]?.trim();
  return marker && title ? { level: marker.length, title } : undefined;
}

export function selectBlockHeading(
  block: SemanticBlock,
  requestedHeading: string,
): SemanticBlock | undefined {
  const target = normalizeHeading(requestedHeading);
  if (block.heading && normalizeHeading(block.heading) === target) return block;

  let targetLevel: number | undefined;
  let matched = false;
  const chunks = block.chunks.flatMap((chunk) => {
    if (targetLevel === undefined && matched) return [];
    const lines = chunk.markdown.split("\n");
    let start = matched ? 0 : -1;
    let end = lines.length;

    for (let index = 0; index < lines.length; index += 1) {
      const heading = parseMarkdownHeading(lines[index] ?? "");
      if (!heading) continue;
      if (!matched && normalizeHeading(heading.title) === target) {
        matched = true;
        targetLevel = heading.level;
        start = index;
        continue;
      }
      if (matched && targetLevel !== undefined && heading.level <= targetLevel) {
        end = index;
        targetLevel = undefined;
        break;
      }
    }

    if (start < 0 || start >= end) return [];
    const markdown = lines.slice(start, end).join("\n").trimEnd();
    return markdown ? [{ ...chunk, markdown }] : [];
  });

  return matched ? { ...block, chunks } : undefined;
}

function paragraphAtoms(markdown: string): string[] {
  const atoms: string[] = [];
  let current: string[] = [];
  let fence: { character: string; length: number } | undefined;

  const flush = () => {
    const value = current.join("\n").trim();
    if (value) atoms.push(value);
    current = [];
  };

  for (const line of markdown.split("\n")) {
    const marker = line.match(/^\s*(```+|~~~+)/)?.[1];
    if (marker) {
      if (!fence) {
        fence = { character: marker[0] ?? "", length: marker.length };
      } else if (
        marker[0] === fence.character &&
        marker.length >= fence.length &&
        line.trim() === marker
      ) {
        fence = undefined;
      }
    }
    if (!fence && line.trim() === "") flush();
    else current.push(line);
  }
  flush();
  return atoms;
}

function splitPlainText(value: string, limit: number): string[] {
  if (value.length <= limit) return [value];
  const parts: string[] = [];
  let remaining = value;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const candidates = [
      window.lastIndexOf("\n"),
      window.lastIndexOf(". "),
      window.lastIndexOf("; "),
      window.lastIndexOf(", "),
      window.lastIndexOf(" "),
    ];
    const splitAt = Math.max(...candidates);
    const end = splitAt >= Math.floor(limit * 0.5) ? splitAt + 1 : limit;
    parts.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function splitCodeText(value: string, limit: number): string[] {
  if (value.length <= limit) return [value];
  const parts: string[] = [];
  let remaining = value;
  while (remaining.length > limit) {
    const newline = remaining.lastIndexOf("\n", limit);
    if (newline > 0) {
      parts.push(remaining.slice(0, newline));
      remaining = remaining.slice(newline + 1);
    } else {
      parts.push(remaining.slice(0, limit));
      remaining = remaining.slice(limit);
    }
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function splitFencedCode(value: string, limit: number): string[] | undefined {
  const lines = value.split("\n");
  const opener = lines[0];
  const closer = lines.at(-1);
  const marker = opener?.match(/^\s*(`{3,}|~{3,})/)?.[1];
  if (!opener || !closer || !marker) return undefined;
  const closingMarker = closer.trim();
  if (
    closingMarker[0] !== marker[0] ||
    closingMarker.length < marker.length ||
    !closingMarker.split("").every((character) => character === marker[0])
  ) {
    return undefined;
  }
  const wrapperSize = opener.length + closer.length + 2;
  const bodyLimit = Math.max(80, limit - wrapperSize);
  const body = lines.slice(1, -1).join("\n");
  return splitCodeText(body, bodyLimit).map((part) => `${opener}\n${part}\n${closer}`);
}

function splitTable(value: string, limit: number): string[] | undefined {
  const lines = value.split("\n");
  if (
    lines.length < 3 ||
    !lines[0]?.includes("|") ||
    !/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(lines[1] ?? "")
  ) {
    return undefined;
  }
  const header = `${lines[0]}\n${lines[1]}`;
  const rows = lines.slice(2);
  const parts: string[] = [];
  let current = header;
  for (const row of rows) {
    if (`${current}\n${row}`.length > limit && current !== header) {
      parts.push(current);
      current = `${header}\n${row}`;
    } else {
      current = `${current}\n${row}`;
    }
  }
  if (current !== header) parts.push(current);
  return parts.length > 0 && parts.every((part) => part.length <= limit) ? parts : undefined;
}

export function splitMarkdownSafely(markdown: string, limit: number): string[] {
  if (limit < 100) throw new RangeError("Markdown split limit must be at least 100 characters");
  const expanded = paragraphAtoms(markdown).flatMap((atom) => {
    if (atom.length <= limit) return [atom];
    return splitFencedCode(atom, limit) ?? splitTable(atom, limit) ?? splitPlainText(atom, limit);
  });
  const groups: string[] = [];
  let current = "";
  for (const atom of expanded) {
    const combined = current ? `${current}\n\n${atom}` : atom;
    if (combined.length > limit && current) {
      groups.push(current);
      current = atom;
    } else {
      current = combined;
    }
  }
  if (current) groups.push(current);
  return groups;
}

function blockMarkdown(block: SemanticBlock): string {
  return block.chunks
    .map((chunk) => chunk.markdown)
    .filter(Boolean)
    .join("\n\n");
}

export function paginateDocument(
  document: RenderedDocument,
  maxCharacters: number,
  requestedHeading?: string,
): DocumentPage[] {
  const normalizedHeading = requestedHeading ? normalizeHeading(requestedHeading) : undefined;
  let globalBlockIndex = 0;
  const selected = document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => {
      const blockIndex = globalBlockIndex;
      globalBlockIndex += 1;
      if (
        normalizedHeading &&
        !blockHeadings(block).some((heading) => normalizeHeading(heading) === normalizedHeading)
      ) {
        return [];
      }
      return [{ section: section.name, block, blockIndex }];
    }),
  );
  if (requestedHeading && selected.length === 0) return [];

  const pageHeader = `# ${document.title}`;
  const available = Math.max(100, maxCharacters - pageHeader.length - 2);
  const descriptionUnits = document.description
    ? splitMarkdownSafely(document.description, available).map((text) => ({
        text,
        blockIndex: 0,
      }))
    : [];
  const blockUnits = selected.flatMap(({ section, block, blockIndex }) => {
    const headings = [`## ${section}`, ...(block.heading ? [`### ${block.heading}`] : [])];
    const prefix = headings.join("\n\n");
    const contentLimit = Math.max(100, available - prefix.length - 2);
    const content = blockMarkdown(block);
    const fragments = content ? splitMarkdownSafely(content, contentLimit) : [""];
    return fragments.map((fragment) => ({
      text: fragment ? `${prefix}\n\n${fragment}` : prefix,
      blockIndex,
    }));
  });
  const units = [...descriptionUnits, ...blockUnits];

  if (units.length === 0) {
    return [
      {
        markdown: pageHeader.slice(0, maxCharacters),
        startBlock: 0,
        endBlock: 0,
      },
    ];
  }

  const pages: DocumentPage[] = [];
  let body = "";
  let startBlock = units[0]?.blockIndex ?? 0;
  let endBlock = startBlock;
  for (const unit of units) {
    const combined = body ? `${body}\n\n${unit.text}` : unit.text;
    if (`${pageHeader}\n\n${combined}`.length > maxCharacters && body) {
      pages.push({ markdown: `${pageHeader}\n\n${body}`, startBlock, endBlock });
      body = unit.text;
      startBlock = unit.blockIndex;
      endBlock = unit.blockIndex;
    } else {
      body = combined;
      endBlock = unit.blockIndex;
    }
  }
  if (body) pages.push({ markdown: `${pageHeader}\n\n${body}`, startBlock, endBlock });
  return pages;
}
