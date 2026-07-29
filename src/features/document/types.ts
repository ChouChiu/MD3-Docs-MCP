export interface MediaItem {
  type: "image" | "video" | "prototype" | "code";
  url: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
}

export interface SemanticChunk {
  id: string;
  markdown: string;
  media: MediaItem[];
}

export interface SemanticBlock {
  id: string;
  heading?: string;
  chunks: SemanticChunk[];
}

export interface SemanticSection {
  name: string;
  blocks: SemanticBlock[];
}

export interface SemanticDocument {
  title: string;
  description?: string;
  basePath: string;
  updatedAt?: string;
  sections: SemanticSection[];
  carbonVersion: string;
}

export interface RenderedDocument extends SemanticDocument {
  canonicalPath: string;
  sourceUrl: string;
  section?: string;
  availableSections: string[];
  availableHeadings: string[];
  markdown: string;
  media: MediaItem[];
}

export interface DocumentPage {
  markdown: string;
  startBlock: number;
  endBlock: number;
}
