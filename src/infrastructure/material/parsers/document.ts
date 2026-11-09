import { z } from "zod/v4";
import { Md3Error } from "../../../shared/errors/md3-error.js";
import type { DocumentData } from "../types.js";

const contentChunkSchema = z.object({
  htmlValue: z.string().nullish(),
  footer: z.string().nullish(),
  imageUrl: z.string().nullish(),
  imageUrlFife: z.string().nullish(),
  imageWidth: z.number().nullish(),
  imageHeight: z.number().nullish(),
  altText: z.string().nullish(),
  videoUrl: z.string().nullish(),
  videoWidth: z.number().nullish(),
  videoHeight: z.number().nullish(),
  prototypeUrl: z.string().nullish(),
  codeUrl: z.string().nullish(),
  linkUrl: z.string().nullish(),
  snippetCode: z.string().nullish(),
  snippetLanguage: z.string().nullish(),
  resourceName: z.string().nullish(),
  libraryModuleType: z.string().nullish(),
  contentChunkType: z.string().nullish(),
});

const contentBlockSchema = z.object({
  title: z.string().nullish(),
  isHidden: z.boolean().optional(),
  contentChunks: z.array(contentChunkSchema).optional(),
});

const contentSectionSchema = z.object({
  name: z.string().nullish(),
  isVisible: z.boolean().optional(),
  contentBlocks: z.array(contentBlockSchema).optional(),
});

const documentSchema = z.object({
  title: z.string(),
  description: z.string().nullish(),
  updatedTimestamp: z.string().nullish(),
  sections: z.array(contentSectionSchema),
});

/** Parse one `_dsm/content` document payload; shape drift surfaces as UPSTREAM_SCHEMA. */
export function parseDocumentData(input: string): DocumentData {
  try {
    return documentSchema.parse(JSON.parse(input));
  } catch (error) {
    throw new Md3Error("UPSTREAM_SCHEMA", "Invalid Material 3 document response", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}
