import type { Md3Client } from "../../infrastructure/material/client.js";
import { slugify } from "../../infrastructure/material/parsers.js";
import { TtlLruCache } from "../../shared/cache/ttl-lru-cache.js";
import { Md3Error } from "../../shared/errors/md3-error.js";
import { renderDocument } from "./render-document.js";
import { blockHeadings, selectBlockHeading } from "./semantic-markdown.js";
import type { RenderedDocument, SemanticDocument } from "./types.js";

function normalizeHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, " ");
}

export class DocumentService {
  readonly #client: Md3Client;
  readonly #cache: TtlLruCache;

  constructor(client: Md3Client, cache = new TtlLruCache()) {
    this.#client = client;
    this.#cache = cache;
  }

  async readDocument(
    input: string,
    requestedSection?: string,
    requestedHeading?: string,
  ): Promise<RenderedDocument> {
    const fetched = await this.#client.getDocument(input, requestedSection);
    const key = `semantic:${fetched.carbonVersion}:${fetched.resolved.route.documentId}`;
    const semantic = await this.#cache.getOrLoad(key, () =>
      renderDocument(
        fetched.document,
        fetched.resolved.route.path,
        fetched.carbonVersion,
        (resourceName) => this.#client.loadResourceData(fetched.carbonVersion, resourceName),
      ),
    );
    return this.#select(semantic, fetched.resolved.section, requestedHeading);
  }

  #select(
    document: SemanticDocument,
    requestedSection?: string,
    requestedHeading?: string,
  ): RenderedDocument {
    const availableSections = document.sections.map((section) => section.name);
    const sections = requestedSection
      ? document.sections.filter((section) => slugify(section.name) === slugify(requestedSection))
      : document.sections;
    if (requestedSection && sections.length === 0) {
      throw new Md3Error("NOT_FOUND", "Requested document section was not found", {
        section: requestedSection,
        availableSections,
      });
    }
    const availableHeadings = [
      ...new Set(sections.flatMap((section) => section.blocks.flatMap(blockHeadings))),
    ];
    if (
      requestedHeading &&
      !availableHeadings.some(
        (heading) => normalizeHeading(heading) === normalizeHeading(requestedHeading),
      )
    ) {
      throw new Md3Error("NOT_FOUND", "Requested document heading was not found", {
        heading: requestedHeading,
        availableHeadings,
      });
    }
    const selectedSections = requestedHeading
      ? sections.map((section) => ({
          ...section,
          blocks: section.blocks.flatMap((block) => {
            const selected = selectBlockHeading(block, requestedHeading);
            return selected ? [selected] : [];
          }),
        }))
      : sections;
    const canonicalPath = requestedSection
      ? `${document.basePath}/${slugify(requestedSection)}`
      : document.basePath;
    const markdown = [
      `# ${document.title}`,
      document.description ?? "",
      ...selectedSections.flatMap((section) => [
        `## ${section.name}`,
        ...section.blocks.flatMap((block) => [
          ...(block.heading ? [`### ${block.heading}`] : []),
          ...block.chunks.map((chunk) => chunk.markdown),
        ]),
      ]),
    ]
      .filter(Boolean)
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return {
      ...document,
      canonicalPath,
      sourceUrl: `https://m3.material.io/${canonicalPath}`,
      ...(requestedSection ? { section: requestedSection } : {}),
      sections: selectedSections,
      availableSections,
      availableHeadings,
      markdown,
      media: selectedSections.flatMap((section) =>
        section.blocks.flatMap((block) => block.chunks.flatMap((chunk) => chunk.media)),
      ),
    };
  }
}
