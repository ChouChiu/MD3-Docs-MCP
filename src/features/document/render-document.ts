import { createHash } from "node:crypto";
import { NodeHtmlMarkdown } from "node-html-markdown";
import type { ContentChunk, DocumentData } from "../../infrastructure/material/types.js";
import { mapConcurrent } from "../../shared/async/map-concurrent.js";
import type {
  MediaItem,
  SemanticBlock,
  SemanticChunk,
  SemanticDocument,
  SemanticSection,
} from "./types.js";

const converter = new NodeHtmlMarkdown({
  bulletMarker: "-",
  codeBlockStyle: "fenced",
  keepDataImages: false,
  maxConsecutiveNewlines: 2,
  useInlineLinks: true,
});

function htmlToMarkdown(html: string | null | undefined): string {
  return html ? converter.translate(html).trim() : "";
}

function mediaMarkdown(item: MediaItem): string {
  const dimensions =
    item.width && item.height
      ? ` (${item.width}×${item.height})`
      : item.width
        ? ` (${item.width}px wide)`
        : "";
  const caption = item.caption ? ` — ${item.caption}` : "";
  if (item.type === "image") {
    return `![${item.alt ?? "Material Design image"}](${item.url})${dimensions}${caption}`;
  }
  const label = item.alt || item.caption || `Material Design ${item.type}`;
  return `[${label}](${item.url})${dimensions}`;
}

function chunkMedia(chunk: ContentChunk): MediaItem[] {
  const caption = htmlToMarkdown(chunk.footer);
  const common = {
    ...(chunk.altText ? { alt: chunk.altText } : {}),
    ...(caption ? { caption } : {}),
  };
  const media: MediaItem[] = [];
  const imageUrl = chunk.imageUrl || chunk.imageUrlFife;
  if (imageUrl) {
    media.push({
      type: "image",
      url: imageUrl,
      ...common,
      ...(chunk.imageWidth ? { width: chunk.imageWidth } : {}),
      ...(chunk.imageHeight ? { height: chunk.imageHeight } : {}),
    });
  }
  if (chunk.videoUrl) {
    media.push({
      type: "video",
      url: chunk.videoUrl,
      ...common,
      ...(chunk.videoWidth ? { width: chunk.videoWidth } : {}),
      ...(chunk.videoHeight ? { height: chunk.videoHeight } : {}),
    });
  }
  if (chunk.prototypeUrl) media.push({ type: "prototype", url: chunk.prototypeUrl, ...common });
  if (chunk.codeUrl) media.push({ type: "code", url: chunk.codeUrl, ...common });
  return media;
}

function renderResource(resource: unknown): string {
  if (!resource || typeof resource !== "object") return "";
  const value = resource as Record<string, unknown>;
  const lines: string[] = [];
  if (typeof value.displayName === "string") lines.push(`**${value.displayName}**`);
  if (typeof value.definition === "string") lines.push(value.definition);
  if (Array.isArray(value.connections)) {
    lines.push("| Resource | Type | Status |", "| --- | --- | --- |");
    const connections = [...value.connections].sort((left, right) => {
      const a = Number((left as Record<string, unknown>).orderInComponent ?? 0);
      const b = Number((right as Record<string, unknown>).orderInComponent ?? 0);
      return a - b;
    });
    for (const connection of connections) {
      if (!connection || typeof connection !== "object") continue;
      const item = connection as Record<string, unknown>;
      const label = String(item.displayName ?? "Resource").replaceAll("|", "\\|");
      const url = typeof item.resourceUrl === "string" ? item.resourceUrl : undefined;
      const name = url ? `[${label}](${url})` : label;
      const type = String(item.resourceType ?? "").replaceAll("_", " ");
      const status = String(item.status ?? "");
      lines.push(`| ${name} | ${type} | ${status} |`);
    }
  }
  return lines.join("\n");
}

function stableId(...parts: Array<string | number>): string {
  return createHash("sha256").update(parts.join(":")).digest("base64url").slice(0, 16);
}

function renderChunk(
  chunk: ContentChunk,
  id: string,
  resources: ReadonlyMap<string, unknown>,
  unavailableResources: ReadonlySet<string>,
): SemanticChunk {
  const output: string[] = [];
  const text = htmlToMarkdown(chunk.htmlValue);
  if (text) output.push(text);
  if (chunk.snippetCode) {
    output.push(`\`\`\`${chunk.snippetLanguage ?? ""}\n${chunk.snippetCode}\n\`\`\``);
  }
  if (chunk.resourceName) {
    const resourceMarkdown = renderResource(resources.get(chunk.resourceName));
    if (resourceMarkdown) output.push(resourceMarkdown);
    else if (unavailableResources.has(chunk.resourceName)) {
      output.push(`Resource data: \`${chunk.resourceName}\` (currently unavailable)`);
    }
  }
  const media = chunkMedia(chunk);
  output.push(...media.map(mediaMarkdown));
  if (chunk.footer && media.length === 0) {
    const footer = htmlToMarkdown(chunk.footer);
    if (footer) output.push(footer);
  }
  if (chunk.linkUrl && !media.some((item) => item.url === chunk.linkUrl)) {
    output.push(`[Related resource](${chunk.linkUrl})`);
  }
  return {
    id,
    markdown: output
      .filter(Boolean)
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    media,
  };
}

export async function renderDocument(
  document: DocumentData,
  basePath: string,
  carbonVersion: string,
  loadResource: (name: string) => Promise<unknown>,
): Promise<SemanticDocument> {
  const visibleSections = document.sections.filter((section) => section.isVisible !== false);
  const resourceNames = [
    ...new Set(
      visibleSections.flatMap((section) =>
        (section.contentBlocks ?? []).flatMap((block) =>
          (block.contentChunks ?? []).flatMap((chunk) =>
            chunk.resourceName ? [chunk.resourceName] : [],
          ),
        ),
      ),
    ),
  ];
  const resources = new Map<string, unknown>();
  const unavailableResources = new Set<string>();
  await mapConcurrent(resourceNames, 4, async (name) => {
    try {
      resources.set(name, await loadResource(name));
    } catch {
      unavailableResources.add(name);
    }
  });

  const sections: SemanticSection[] = visibleSections.map((section, sectionIndex) => {
    const name = section.name?.trim() || `Section ${sectionIndex + 1}`;
    const blocks: SemanticBlock[] = (section.contentBlocks ?? []).flatMap((block, blockIndex) => {
      if (block.isHidden) return [];
      const chunks = (block.contentChunks ?? [])
        .map((chunk, chunkIndex) =>
          renderChunk(
            chunk,
            stableId(carbonVersion, basePath, sectionIndex, blockIndex, chunkIndex),
            resources,
            unavailableResources,
          ),
        )
        .filter((chunk) => chunk.markdown || chunk.media.length > 0);
      if (chunks.length === 0 && !block.title) return [];
      return [
        {
          id: stableId(carbonVersion, basePath, sectionIndex, blockIndex),
          ...(block.title ? { heading: block.title } : {}),
          chunks,
        },
      ];
    });
    return { name, blocks };
  });

  return {
    title: document.title,
    ...(document.description ? { description: document.description } : {}),
    basePath,
    ...(document.updatedTimestamp ? { updatedAt: document.updatedTimestamp } : {}),
    sections,
    carbonVersion,
  };
}
