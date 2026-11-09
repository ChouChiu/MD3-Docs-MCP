import type {
  DirectoryEntry,
  Md3Client,
  SearchPageResult,
} from "../../infrastructure/material/index.js";
import { mapConcurrent } from "../../shared/async/map-concurrent.js";
import { Md3Error } from "../../shared/errors/md3-error.js";
import { slugify } from "../../shared/text/slug.js";
import {
  blockMarkdown,
  type DocumentService,
  type RenderedDocument,
  splitMarkdownSafely,
} from "../document/index.js";
import {
  directoryScore,
  isReviewSection,
  lexicalScore,
  plainCriterion,
  queryTerms,
  sectionWeight,
  warningMessage,
} from "./ranking.js";
import type { ChecklistItem, ContextRequest, ContextResult, ContextSource } from "./types.js";

const CANDIDATE_CONCURRENCY = 4;
const MAX_CHECKLIST_ITEMS = 8;
const CHECKLIST_BUDGET_RATIO = 0.2;
const CHECKLIST_MAX_CHARACTERS = 2_500;

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

function upsertCandidate(target: Map<string, Candidate>, candidate: Candidate): void {
  const current = target.get(candidate.path);
  if (!current) {
    target.set(candidate.path, candidate);
    return;
  }
  if (current.pinned && !candidate.pinned) return;
  if (!current.pinned && candidate.pinned) {
    target.set(candidate.path, candidate);
    return;
  }
  if (candidate.score > current.score) target.set(candidate.path, candidate);
}

function byRelevance(left: Candidate, right: Candidate): number {
  return Number(right.pinned) - Number(left.pinned) || right.score - left.score;
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
    const warn = (prefix: string, error: unknown) => {
      const message = warningMessage(prefix, error);
      if (!warnings.includes(message)) warnings.push(message);
    };

    const [searchState, directoryState] = await Promise.allSettled([
      this.#client.search(request.task, request.category, 1, 20),
      this.#client.getDirectory(),
    ]);
    if (searchState.status === "rejected") {
      warn("Official search was unavailable", searchState.reason);
    }
    if (directoryState.status === "rejected") {
      warn("Document directory was unavailable", directoryState.reason);
    }

    const seeds = this.#seedCandidates(request, terms, searchState, directoryState);
    if (seeds.size === 0) {
      if (searchState.status === "rejected" && directoryState.status === "rejected") {
        throw new Md3Error(
          "UPSTREAM_HTTP",
          "Official search and document directory were unavailable",
          { warnings },
        );
      }
      throw new Md3Error("NOT_FOUND", "No official MD3 documents matched this task");
    }

    const expanded = new Map<string, Candidate>();
    const seedList = [...seeds.values()].sort(byRelevance).slice(0, request.maxSources * 4);
    await mapConcurrent(seedList, CANDIDATE_CONCURRENCY, async (seed) => {
      try {
        const resolved = await this.#client.resolveDocument(seed.path);
        upsertCandidate(expanded, {
          path: resolved.canonicalPath,
          score: seed.score + sectionWeight(request.mode, resolved.section),
          pinned: seed.pinned,
        });
        if (request.mode === "research") return;
        for (const tab of resolved.route.tabs) {
          const weight = sectionWeight(request.mode, tab);
          if (weight <= 0) continue;
          upsertCandidate(expanded, {
            path: `${resolved.route.path}/${slugify(tab)}`,
            score: seed.score + weight,
            pinned: false,
          });
        }
      } catch (error) {
        if (seed.pinned) warn(`Pinned path ${seed.path} failed`, error);
      }
    });
    if (expanded.size === 0) {
      throw new Md3Error("NOT_FOUND", "No official MD3 documents could be resolved", { warnings });
    }

    const candidates = [...expanded.values()].sort(byRelevance).slice(0, request.maxSources + 4);
    const loaded = await mapConcurrent(candidates, CANDIDATE_CONCURRENCY, async (candidate) => {
      try {
        return {
          candidate,
          document: await this.#documents.readDocument(candidate.path),
        } satisfies LoadedSource;
      } catch (error) {
        warn(`Document ${candidate.path} failed`, error);
        return undefined;
      }
    });
    const successful = loaded
      .filter((item): item is LoadedSource => item !== undefined)
      .slice(0, request.maxSources);
    if (successful.length === 0) {
      throw new Md3Error("UPSTREAM_HTTP", "No MD3 context sources could be loaded", { warnings });
    }

    const sources: ContextSource[] = successful.map(({ document }, index) => ({
      id: `S${index + 1}`,
      title: document.title,
      path: document.canonicalPath,
      ...(document.section ? { section: document.section } : {}),
      sourceUrl: document.sourceUrl,
      ...(document.updatedAt ? { updatedAt: document.updatedAt } : {}),
    }));
    const evidence = this.#collectEvidence(successful, sources, request, terms);
    if (evidence.length === 0) {
      throw new Md3Error("NOT_FOUND", "The matched MD3 documents contained no usable text");
    }

    const orderedEvidence = rankEvidence(evidence, sources);
    const checklist = request.mode === "review" ? reviewChecklist(orderedEvidence) : [];
    const composed = composeContext(request, orderedEvidence, checklist);
    if (composed.used === 0) {
      throw new Md3Error("INVALID_REQUEST", "The context budget is too small for any evidence");
    }

    // Only report labels whose citation actually survived the character budget.
    const citedSources = sources.filter((source) => composed.cited.has(source.id));
    return {
      task: request.task,
      mode: request.mode,
      markdown: composed.markdown,
      sources: citedSources,
      checklist: composed.checklist,
      warnings,
      truncated:
        composed.clipped ||
        citedSources.length < sources.length ||
        composed.checklist.length < checklist.length ||
        composed.used < evidence.length ||
        candidates.length > successful.length,
    };
  }

  /** Pinned paths, official search hits, and lexical directory matches, scored together. */
  #seedCandidates(
    request: ContextRequest,
    terms: readonly string[],
    searchState: PromiseSettledResult<SearchPageResult>,
    directoryState: PromiseSettledResult<DirectoryEntry[]>,
  ): Map<string, Candidate> {
    const seeds = new Map<string, Candidate>();
    request.paths.forEach((path, index) => {
      upsertCandidate(seeds, { path, score: 10_000 - index, pinned: true });
    });
    if (searchState.status === "fulfilled") {
      searchState.value.hits.forEach((hit, index) => {
        upsertCandidate(seeds, { path: hit.path, score: 2_000 - index * 20, pinned: false });
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
    return seeds;
  }

  #collectEvidence(
    loaded: readonly LoadedSource[],
    sources: readonly ContextSource[],
    request: ContextRequest,
    terms: readonly string[],
  ): Evidence[] {
    return loaded.flatMap(({ candidate, document }, sourceIndex) => {
      const source = sources[sourceIndex];
      if (!source) return [];
      return document.sections.flatMap((section) =>
        section.blocks.flatMap((block) => {
          const markdown = blockMarkdown(block);
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
  }
}

/** One strongest block per source first, then everything else by score. */
function rankEvidence(
  evidence: readonly Evidence[],
  sources: readonly ContextSource[],
): Evidence[] {
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
  return [...diverse, ...remaining];
}

function reviewChecklist(evidence: readonly Evidence[]): ChecklistItem[] {
  const seen = new Set<string>();
  const checklist: ChecklistItem[] = [];
  for (const item of evidence) {
    if (!isReviewSection(item.section)) continue;
    const criterion = item.heading ?? plainCriterion(item.markdown);
    if (!criterion) continue;
    const key = `${item.source.id}:${criterion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    checklist.push({
      criterion,
      sourceId: item.source.id,
      sourceUrl: item.source.sourceUrl,
    });
    if (checklist.length === MAX_CHECKLIST_ITEMS) break;
  }
  return checklist;
}

/** Assemble the cited Markdown body within `maxCharacters`. */
function composeContext(
  request: ContextRequest,
  evidence: readonly Evidence[],
  checklist: readonly ChecklistItem[],
): {
  markdown: string;
  used: number;
  clipped: boolean;
  cited: Set<string>;
  checklist: ChecklistItem[];
} {
  const title = `# Material Design 3 context\n\nTask: ${request.task}\n\nMode: ${request.mode}`;
  const checklistResult = checklistLines(request, checklist);
  let markdown = [title, checklistResult.markdown].filter(Boolean).join("\n\n");
  const cited = new Set<string>();
  for (const item of checklistResult.included) cited.add(item.sourceId);

  let used = 0;
  let clipped = false;
  for (const item of evidence) {
    const label = `## [${item.source.id}] ${item.source.title} — ${item.section}`;
    const heading = item.heading ? `\n\n### ${item.heading}` : "";
    const sourceLine = `\n\nSource: ${item.source.sourceUrl}`;
    const wrapperSize = markdown.length + 2 + label.length + heading.length + sourceLine.length + 2;
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
    used += 1;
    cited.add(item.source.id);
    if (fragments.length > 1) clipped = true;
  }
  return {
    markdown,
    used,
    clipped,
    cited,
    checklist: checklist.filter((item) => checklistResult.included.has(item)),
  };
}

function checklistLines(
  request: ContextRequest,
  checklist: readonly ChecklistItem[],
): { markdown: string; included: Set<ChecklistItem> } {
  const included = new Set<ChecklistItem>();
  if (checklist.length === 0) return { markdown: "", included };
  const limit = Math.min(
    CHECKLIST_MAX_CHARACTERS,
    Math.floor(request.maxCharacters * CHECKLIST_BUDGET_RATIO),
  );
  const lines = ["## Review checklist"];
  for (const item of checklist) {
    const next = `- [ ] ${item.criterion} [${item.sourceId}]`;
    if (`${lines.join("\n")}\n${next}`.length > limit) break;
    lines.push(next);
    included.add(item);
  }
  return included.size === 0
    ? { markdown: "", included }
    : { markdown: lines.join("\n"), included };
}
