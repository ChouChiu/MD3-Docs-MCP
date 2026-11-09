export const CATEGORIES = ["foundations", "styles", "components"] as const;

export type Category = (typeof CATEGORIES)[number];

/** Upstream JSON is sparse: a field may be absent, null, or present. */
type Nullish<T> = T | null | undefined;

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
  htmlValue?: Nullish<string>;
  footer?: Nullish<string>;
  imageUrl?: Nullish<string>;
  imageUrlFife?: Nullish<string>;
  imageWidth?: Nullish<number>;
  imageHeight?: Nullish<number>;
  altText?: Nullish<string>;
  videoUrl?: Nullish<string>;
  videoWidth?: Nullish<number>;
  videoHeight?: Nullish<number>;
  prototypeUrl?: Nullish<string>;
  codeUrl?: Nullish<string>;
  linkUrl?: Nullish<string>;
  snippetCode?: Nullish<string>;
  snippetLanguage?: Nullish<string>;
  resourceName?: Nullish<string>;
  libraryModuleType?: Nullish<string>;
  contentChunkType?: Nullish<string>;
}

export interface ContentBlock {
  title?: Nullish<string>;
  isHidden?: boolean | undefined;
  contentChunks?: Nullish<ContentChunk[]>;
}

export interface ContentSection {
  name?: Nullish<string>;
  isVisible?: boolean | undefined;
  contentBlocks?: Nullish<ContentBlock[]>;
}

export interface DocumentData {
  title: string;
  description?: Nullish<string>;
  updatedTimestamp?: Nullish<string>;
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
  section?: string;
}
