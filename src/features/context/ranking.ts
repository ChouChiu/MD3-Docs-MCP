import type { DirectoryEntry } from "../../infrastructure/material/types.js";
import { slugify } from "../../shared/text/slug.js";
import type { ContextMode } from "./types.js";

const SECTION_WEIGHTS: Record<ContextMode, Record<string, number>> = {
  implementation: { overview: 240, guidelines: 320, specs: 280, accessibility: 220 },
  review: { guidelines: 360, accessibility: 340, specs: 180, overview: 100 },
  research: {},
};

const REVIEW_SECTIONS = new Set(["guidelines", "accessibility"]);

/** Words worth ranking on: lowercased, deduplicated, and longer than two characters. */
export function queryTerms(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 2),
    ),
  ];
}

export function lexicalScore(value: string, terms: readonly string[]): number {
  const normalized = value.toLowerCase();
  return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}

/** Workflow-specific bias toward the tabs that answer each mode's question. */
export function sectionWeight(mode: ContextMode, section: string | undefined): number {
  const normalized = section ? slugify(section) : "";
  return SECTION_WEIGHTS[mode][normalized] ?? 0;
}

export function directoryScore(entry: DirectoryEntry, terms: readonly string[]): number {
  return (
    lexicalScore(entry.title, terms) * 8 +
    lexicalScore(entry.path, terms) * 5 +
    lexicalScore(entry.description ?? "", terms) * 2
  );
}

export function isReviewSection(section: string): boolean {
  return REVIEW_SECTIONS.has(slugify(section));
}

/** One short, citation-friendly sentence from an evidence block. */
export function plainCriterion(markdown: string): string {
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

export function warningMessage(prefix: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${prefix}: ${message}`.slice(0, 500);
}
