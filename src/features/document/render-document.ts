import { createHash } from "node:crypto";
import { NodeHtmlMarkdown } from "node-html-markdown";
import type {
  ContentChunk,
  ContentSection,
  DocumentData,
} from "../../infrastructure/material/types.js";
import { mapConcurrent } from "../../shared/async/map-concurrent.js";
import { joinMarkdown } from "./markdown/join.js";
import { renderResource } from "./render-resource.js";
import type {
  MediaItem,
  SemanticBlock,
  SemanticChunk,
  SemanticDocument,
  SemanticSection,
} from "./types.js";

const RESOURCE_CONCURRENCY = 4;

const converter = new NodeHtmlMarkdown({
  bulletMarker: "-",
  codeBlockStyle: "fenced",
  keepDataImages: false,
  maxConsecutiveNewlines: 2,
  useInlineLinks: true,
});

export function htmlToMarkdown(html: string | null | undefined): string {
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

/** Media referenced by one chunk, in the order the site presents it. */
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
  return { id, markdown: joinMarkdown(output), media };
}

/** Resource names referenced by visible sections, deduplicated in document order. */
function resourceNames(sections: readonly ContentSection[]): string[] {
  return [
    ...new Set(
      sections.flatMap((section) =>
        (section.contentBlocks ?? [])
          .filter((block) => !block.isHidden)
          .flatMap((block) =>
            (block.contentChunks ?? []).flatMap((chunk) =>
              chunk.resourceName ? [chunk.resourceName] : [],
            ),
          ),
      ),
    ),
  ];
}

export async function renderDocument(
  document: DocumentData,
  basePath: string,
  carbonVersion: string,
  loadResource: (name: string) => Promise<unknown>,
): Promise<SemanticDocument> {
  const visibleSections = document.sections.filter((section) => section.isVisible !== false);
  const resources = new Map<string, unknown>();
  const unavailableResources = new Set<string>();
  await mapConcurrent(resourceNames(visibleSections), RESOURCE_CONCURRENCY, async (name) => {
    try {
      resources.set(name, await loadResource(name));
    } catch {
      // A missing table is rendered as an explicit placeholder, not a failed document.
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
