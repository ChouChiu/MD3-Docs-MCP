import type { Category } from "../../infrastructure/material/types.js";

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
