export const CATEGORIES = ["foundations", "styles", "components"] as const;

export type Category = (typeof CATEGORIES)[number];

export interface RouteEntry {
  path: string;
  documentId: string;
  title?: string;
  description?: string;
  tabs: string[];
}

export interface SiteIndex {
  carbonVersion: string;
  routes: Map<string, RouteEntry>;
  mainScriptUrl: string;
}

export interface DirectoryEntry {
  category: Category;
  path: string;
  url: string;
  title: string;
  description?: string;
  tabs: string[];
  updatedAt?: string;
}

export interface ContentChunk {
  htmlValue?: string | null;
  footer?: string | null;
  imageUrl?: string | null;
  imageUrlFife?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  altText?: string | null;
  videoUrl?: string | null;
  videoWidth?: number | null;
  videoHeight?: number | null;
  prototypeUrl?: string | null;
  codeUrl?: string | null;
  linkUrl?: string | null;
  snippetCode?: string | null;
  snippetLanguage?: string | null;
  resourceName?: string | null;
  libraryModuleType?: string | null;
  contentChunkType?: string | null;
}

export interface ContentBlock {
  title?: string | null;
  isHidden?: boolean;
  contentChunks?: ContentChunk[];
}

export interface ContentSection {
  name?: string | null;
  isVisible?: boolean;
  contentBlocks?: ContentBlock[];
}

export interface DocumentData {
  title: string;
  description?: string | null;
  updatedTimestamp?: string | null;
  sections: ContentSection[];
}

export interface ResolvedDocument {
  route: RouteEntry;
  canonicalPath: string;
  section?: string;
}

export interface SearchHit {
  title: string;
  snippet: string;
  path: string;
  url: string;
  category: Category;
}
