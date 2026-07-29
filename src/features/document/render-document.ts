import { NodeHtmlMarkdown } from "node-html-markdown";
import type {
  ContentChunk,
  ContentSection,
  DocumentData,
  ResolvedDocument,
} from "../../infrastructure/material/types.js";
import { Md3Error } from "../../shared/errors/md3-error.js";
import type { MediaItem, RenderedDocument } from "./types.js";

const converter = new NodeHtmlMarkdown(
  {
    bulletMarker: "-",
    codeBlockStyle: "fenced",
    keepDataImages: false,
    maxConsecutiveNewlines: 2,
    useInlineLinks: true,
  },
  undefined,
  undefined,
);

function htmlToMarkdown(html: string | null | undefined): string {
  if (!html) return "";
  return converter.translate(html).trim();
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

export async function renderDocument(
  document: DocumentData,
  resolved: ResolvedDocument,
  carbonVersion: string,
  loadResource: (name: string) => Promise<unknown>,
): Promise<RenderedDocument> {
  const availableSections = document.sections
    .filter((section) => section.isVisible !== false && section.name)
    .map((section) => String(section.name));
  const chosenSections = selectSections(document.sections, resolved.section);
  const media: MediaItem[] = [];
  const output: string[] = [`# ${document.title}`];
  if (document.description) output.push(document.description);

  for (const section of chosenSections) {
    if (section.name) output.push(`## ${section.name}`);
    for (const block of section.contentBlocks ?? []) {
      if (block.isHidden) continue;
      if (block.title) output.push(`### ${block.title}`);
      for (const chunk of block.contentChunks ?? []) {
        const text = htmlToMarkdown(chunk.htmlValue);
        if (text) output.push(text);
        if (chunk.snippetCode) {
          output.push(`\`\`\`${chunk.snippetLanguage ?? ""}\n${chunk.snippetCode}\n\`\`\``);
        }
        if (chunk.resourceName) {
          try {
            const resource = await loadResource(chunk.resourceName);
            const resourceMarkdown = renderResource(resource);
            if (resourceMarkdown) output.push(resourceMarkdown);
          } catch {
            output.push(`Resource data: \`${chunk.resourceName}\` (currently unavailable)`);
          }
        }
        const chunkItems = chunkMedia(chunk);
        media.push(...chunkItems);
        output.push(...chunkItems.map(mediaMarkdown));
        if (chunk.footer && chunkItems.length === 0) {
          const footer = htmlToMarkdown(chunk.footer);
          if (footer) output.push(footer);
        }
        if (chunk.linkUrl && !chunkItems.some((item) => item.url === chunk.linkUrl)) {
          output.push(`[Related resource](${chunk.linkUrl})`);
        }
      }
    }
  }

  const section = resolved.section;
  const canonicalPath = resolved.canonicalPath;
  return {
    title: document.title,
    canonicalPath,
    sourceUrl: `https://m3.material.io/${canonicalPath}`,
    ...(section ? { section } : {}),
    ...(document.updatedTimestamp ? { updatedAt: document.updatedTimestamp } : {}),
    availableSections,
    markdown: output
      .filter(Boolean)
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    media,
    carbonVersion,
  };
}

function selectSections(sections: ContentSection[], requested?: string): ContentSection[] {
  const visible = sections.filter((section) => section.isVisible !== false);
  if (!requested) return visible;
  const normalized = requested.trim().toLowerCase().replace(/-/g, " ");
  const selected = visible.filter(
    (section) => section.name?.trim().toLowerCase().replace(/-/g, " ") === normalized,
  );
  if (selected.length === 0) {
    throw new Md3Error("NOT_FOUND", "Requested document section was not found", {
      section: requested,
      availableSections: visible.flatMap((section) => (section.name ? [section.name] : [])),
    });
  }
  return selected;
}
