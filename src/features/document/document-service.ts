import type { Md3Client } from "../../infrastructure/material/client.js";
import { SITE_ORIGIN } from "../../infrastructure/material/constants.js";
import type { ResolvedDocument } from "../../infrastructure/material/types.js";
import { TtlLruCache } from "../../shared/cache/ttl-lru-cache.js";
import { Md3Error } from "../../shared/errors/md3-error.js";
import { slugify } from "../../shared/text/slug.js";
import { blockHeadings, includesHeading, joinMarkdown, selectHeading } from "./markdown/index.js";
import { renderDocument } from "./render-document.js";
import type { RenderedDocument, SemanticDocument, SemanticSection } from "./types.js";

function documentMarkdown(
  document: SemanticDocument,
  sections: readonly SemanticSection[],
): string {
  return joinMarkdown([
    `# ${document.title}`,
    document.description ?? "",
    ...sections.flatMap((section) => [
      `## ${section.name}`,
      ...section.blocks.flatMap((block) => [
        ...(block.heading ? [`### ${block.heading}`] : []),
        ...block.chunks.map((chunk) => chunk.markdown),
      ]),
    ]),
  ]);
}

export class DocumentService {
  readonly #client: Md3Client;
  readonly #cache: TtlLruCache;

  constructor(client: Md3Client, cache = new TtlLruCache()) {
    this.#client = client;
    this.#cache = cache;
  }

  /** Read one document, optionally narrowed to a section tab and a single heading. */
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
    return this.#select(semantic, fetched.resolved, requestedHeading);
  }

  #select(
    document: SemanticDocument,
    resolved: ResolvedDocument,
    requestedHeading?: string,
  ): RenderedDocument {
    const availableSections = document.sections.map((section) => section.name);
    const section = resolved.section;
    const scopedSections = section
      ? document.sections.filter((value) => slugify(value.name) === slugify(section))
      : document.sections;
    if (section && scopedSections.length === 0) {
      throw new Md3Error("NOT_FOUND", "Requested document section was not found", {
        section,
        availableSections,
      });
    }

    const availableHeadings = [
      ...new Set(scopedSections.flatMap((value) => value.blocks.flatMap(blockHeadings))),
    ];
    if (requestedHeading && !includesHeading(availableHeadings, requestedHeading)) {
      // The heading may live in another tab; report where so the caller can retry with it.
      const headingSections = document.sections
        .filter((value) => includesHeading(value.blocks.flatMap(blockHeadings), requestedHeading))
        .map((value) => value.name);
      throw new Md3Error("NOT_FOUND", "Requested document heading was not found", {
        heading: requestedHeading,
        ...(headingSections.length > 0 ? { headingSections } : {}),
        availableSections,
        availableHeadings,
      });
    }

    const sections = requestedHeading
      ? selectHeading(scopedSections, requestedHeading)
      : scopedSections;

    return {
      ...document,
      canonicalPath: resolved.canonicalPath,
      sourceUrl: `${SITE_ORIGIN}/${resolved.canonicalPath}`,
      ...(section ? { section } : {}),
      sections,
      availableSections,
      availableHeadings,
      markdown: documentMarkdown(document, sections),
      media: sections.flatMap((value) =>
        value.blocks.flatMap((block) => block.chunks.flatMap((chunk) => chunk.media)),
      ),
    };
  }
}
