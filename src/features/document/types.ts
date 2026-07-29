export interface MediaItem {
  type: "image" | "video" | "prototype" | "code";
  url: string;
  alt?: string;
  caption?: string;
  width?: number;
  height?: number;
}

export interface RenderedDocument {
  title: string;
  canonicalPath: string;
  sourceUrl: string;
  section?: string;
  updatedAt?: string;
  availableSections: string[];
  markdown: string;
  media: MediaItem[];
  carbonVersion: string;
}
