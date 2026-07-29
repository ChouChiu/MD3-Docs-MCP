import type { Category, DirectoryEntry, Md3Client } from "../../infrastructure/material/index.js";
import { slugify } from "../../infrastructure/material/parsers.js";
import { mapConcurrent } from "../../shared/async/map-concurrent.js";
import { Md3Error } from "../../shared/errors/md3-error.js";
import type { DocumentService, RenderedDocument, SemanticBlock } from "../document/index.js";
import { splitMarkdownSafely } from "../document/index.js";

export type ContextMode = "implementation" | "review" | "research";

export interface ContextRequest {
  task: string;
  mode: ContextMode;
  paths: string[];
  category?: Category;
  maxSources: number;
  maxCharacters: number;
}

export interface ContextSource {
  id: string;
  title: string;
  path: string;
  section?: string;
  sourceUrl: string;
  updatedAt?: string;
}

export interface ChecklistItem {
  criterion: string;
  sourceId: string;
  sourceUrl: string;
}

export interface ContextResult {
  task: string;
  mode: ContextMode;
  markdown: string;
  sources: ContextSource[];
  checklist: ChecklistItem[];
  warnings: string[];
  truncated: boolean;
}

interface Candidate {
  path: string;
  score: number;
  pinned: boolean;
}

interface LoadedSource {
  candidate: Candidate;
  document: RenderedDocument;
}

interface Evidence {
  id: string;
  source: ContextSource;
  section: string;
  heading?: string;
  markdown: string;
  score: number;
}

function queryTerms(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 2),
    ),
  ];
}

function lexicalScore(value: string, terms: readonly string[]): number {
  const normalized = value.toLowerCase();
  return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}

function sectionWeight(mode: ContextMode, section: string | undefined): number {
  const normalized = section ? slugify(section) : "";
  if (mode === "implementation") {
    return { overview: 240, guidelines: 320, specs: 280, accessibility: 220 }[normalized] ?? 0;
  }
  if (mode === "review") {
    return { guidelines: 360, accessibility: 340, specs: 180, overview: 100 }[normalized] ?? 0;
  }
  return 0;
}

function directoryScore(entry: DirectoryEntry, terms: readonly string[]): number {
  const title = lexicalScore(entry.title, terms) * 8;
  const path = lexicalScore(entry.path, terms) * 5;
  const description = lexicalScore(entry.description ?? "", terms) * 2;
  return title + path + description;
}

function upsertCandidate(target: Map<string, Candidate>, candidate: Candidate): void {
  const current = target.get(candidate.path);
  if (!current || candidate.score > current.score || (candidate.pinned && !current.pinned)) {
    target.set(candidate.path, candidate);
  }
}

function blockText(block: SemanticBlock): string {
  return block.chunks
    .map((chunk) => chunk.markdown)
    .filter(Boolean)
    .join("\n\n");
}

function plainCriterion(markdown: string): string {
  return (
    markdown
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[#*_`>|-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(/(?<=[.!?])\s+/)[0]
      ?.slice(0, 220) ?? ""
  );
}

function warningMessage(prefix: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${prefix}: ${message}`.slice(0, 500);
}

export class ContextService {
  readonly #client: Md3Client;
  readonly #documents: DocumentService;

  constructor(client: Md3Client, documents: DocumentService) {
    this.#client = client;
    this.#documents = documents;
  }

  async getContext(request: ContextRequest): Promise<ContextResult> {
    const terms = queryTerms(request.task);
    const warnings: string[] = [];
    const [searchState, directoryState] = await Promise.allSettled([
      this.#client.search(request.task, request.category, 1, 20),
      this.#client.getDirectory(),
    ]);
    if (searchState.status === "rejected") {
      warnings.push(warningMessage("Official search was unavailable", searchState.reason));
    }
    if (directoryState.status === "rejected") {
      warnings.push(warningMessage("Document directory was unavailable", directoryState.reason));
    }

    const seeds = new Map<string, Candidate>();
    request.paths.forEach((path, index) => {
      upsertCandidate(seeds, { path, score: 10_000 - index, pinned: true });
    });
    if (searchState.status === "fulfilled") {
      searchState.value.hits.forEach((hit, index) => {
        upsertCandidate(seeds, {
          path: hit.path,
          score: 2_000 - index * 20,
          pinned: false,
        });
      });
    }
    if (directoryState.status === "fulfilled") {
      for (const entry of directoryState.value) {
        if (request.category && entry.category !== request.category) continue;
        const score = directoryScore(entry, terms);
        if (score > 0) {
          upsertCandidate(seeds, { path: entry.path, score: 500 + score, pinned: false });
        }
      }
    }
    if (seeds.size === 0) {
      throw new Md3Error("NOT_FOUND", "No official MD3 documents matched this task");
    }

    const expanded = new Map<string, Candidate>();
    const seedList = [...seeds.values()]
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.score - left.score)
      .slice(0, request.maxSources * 4);
    await mapConcurrent(seedList, 4, async (seed) => {
      try {
        const resolved = await this.#client.resolveDocument(seed.path);
        upsertCandidate(expanded, {
          path: resolved.canonicalPath,
          score: seed.score + sectionWeight(request.mode, resolved.section),
          pinned: seed.pinned,
        });
        if (request.mode !== "research") {
          for (const tab of resolved.route.tabs) {
            const weight = sectionWeight(request.mode, tab);
            if (weight > 0) {
              upsertCandidate(expanded, {
                path: `${resolved.route.path}/${slugify(tab)}`,
                score: seed.score + weight,
                pinned: false,
              });
            }
          }
        }
      } catch (error) {
        if (seed.pinned) warnings.push(warningMessage(`Pinned path ${seed.path} failed`, error));
      }
    });
    if (expanded.size === 0) {
      throw new Md3Error("NOT_FOUND", "No official MD3 documents could be resolved", {
        warnings,
      });
    }

    const candidates = [...expanded.values()]
      .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.score - left.score)
      .slice(0, request.maxSources + 4);
    const loaded = await mapConcurrent(candidates, 4, async (candidate) => {
      try {
        return {
          candidate,
          document: await this.#documents.readDocument(candidate.path),
        } satisfies LoadedSource;
      } catch (error) {
        warnings.push(warningMessage(`Document ${candidate.path} failed`, error));
        return undefined;
      }
    });
    const successful = loaded
      .filter((item): item is LoadedSource => item !== undefined)
      .slice(0, request.maxSources);
    if (successful.length === 0) {
      throw new Md3Error("UPSTREAM_HTTP", "No MD3 context sources could be loaded", {
        warnings,
      });
    }

    const sources: ContextSource[] = successful.map(({ document }, index) => ({
      id: `S${index + 1}`,
      title: document.title,
      path: document.canonicalPath,
      ...(document.section ? { section: document.section } : {}),
      sourceUrl: document.sourceUrl,
      ...(document.updatedAt ? { updatedAt: document.updatedAt } : {}),
    }));
    const evidence = successful.flatMap(({ candidate, document }, sourceIndex) => {
      const source = sources[sourceIndex];
      if (!source) return [];
      return document.sections.flatMap((section) =>
        section.blocks.flatMap((block) => {
          const markdown = blockText(block);
          if (!markdown) return [];
          return [
            {
              id: block.id,
              source,
              section: section.name,
              ...(block.heading ? { heading: block.heading } : {}),
              markdown,
              score:
                candidate.score +
                sectionWeight(request.mode, section.name) +
                lexicalScore(`${block.heading ?? ""} ${markdown}`, terms) * 30,
            } satisfies Evidence,
          ];
        }),
      );
    });
    if (evidence.length === 0) {
      throw new Md3Error("NOT_FOUND", "The matched MD3 documents contained no usable text");
    }

    const bySource = new Map<string, Evidence[]>();
    for (const item of evidence) {
      const values = bySource.get(item.source.id) ?? [];
      values.push(item);
      bySource.set(item.source.id, values);
    }
    for (const values of bySource.values()) values.sort((a, b) => b.score - a.score);
    const diverse = sources.flatMap((source) => bySource.get(source.id)?.slice(0, 1) ?? []);
    const diverseKeys = new Set(diverse.map((item) => `${item.source.id}:${item.id}`));
    const remaining = evidence
      .filter((item) => !diverseKeys.has(`${item.source.id}:${item.id}`))
      .sort((a, b) => b.score - a.score);
    const orderedEvidence = [...diverse, ...remaining];

    const checklist =
      request.mode === "review"
        ? orderedEvidence
            .filter((item) => ["guidelines", "accessibility"].includes(slugify(item.section)))
            .flatMap((item) => {
              const criterion = item.heading ?? plainCriterion(item.markdown);
              return criterion
                ? [
                    {
                      criterion,
                      sourceId: item.source.id,
                      sourceUrl: item.source.sourceUrl,
                    },
                  ]
                : [];
            })
            .filter(
              (item, index, values) =>
                values.findIndex(
                  (other) => other.sourceId === item.sourceId && other.criterion === item.criterion,
                ) === index,
            )
            .slice(0, 8)
        : [];

    const title = `# Material Design 3 context\n\nTask: ${request.task}\n\nMode: ${request.mode}`;
    let checklistMarkdown = "";
    if (checklist.length > 0) {
      const limit = Math.min(2_500, Math.floor(request.maxCharacters * 0.2));
      const lines = ["## Review checklist"];
      for (const item of checklist) {
        const next = `- [ ] ${item.criterion} [${item.sourceId}]`;
        if (`${lines.join("\n")}\n${next}`.length > limit) break;
        lines.push(next);
      }
      checklistMarkdown = lines.join("\n");
    }
    let markdown = [title, checklistMarkdown].filter(Boolean).join("\n\n");
    const selectedEvidence: Evidence[] = [];
    let clipped = false;
    for (const item of orderedEvidence) {
      const label = `## [${item.source.id}] ${item.source.title} — ${item.section}`;
      const heading = item.heading ? `\n\n### ${item.heading}` : "";
      const sourceLine = `\n\nSource: ${item.source.sourceUrl}`;
      const wrapperSize =
        markdown.length + 2 + label.length + heading.length + sourceLine.length + 2;
      const available = request.maxCharacters - wrapperSize;
      if (available < 100) {
        clipped = true;
        break;
      }
      const fragments = splitMarkdownSafely(item.markdown, available);
      const excerpt = fragments[0];
      if (!excerpt) continue;
      const sectionMarkdown = `${label}${heading}${sourceLine}\n\n${excerpt}`;
      if (`${markdown}\n\n${sectionMarkdown}`.length > request.maxCharacters) {
        clipped = true;
        continue;
      }
      markdown = `${markdown}\n\n${sectionMarkdown}`;
      selectedEvidence.push(item);
      if (fragments.length > 1) clipped = true;
    }
    if (selectedEvidence.length === 0) {
      throw new Md3Error("INVALID_REQUEST", "The context budget is too small for any evidence");
    }

    return {
      task: request.task,
      mode: request.mode,
      markdown,
      sources,
      checklist,
      warnings,
      truncated:
        clipped ||
        selectedEvidence.length < evidence.length ||
        candidates.length > successful.length,
    };
  }
}
