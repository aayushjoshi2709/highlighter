import { z } from "zod";
import { HIGHLIGHT_COLORS } from "./constants";

export { HIGHLIGHT_COLORS };
export const HighlightColorSchema = z.enum(HIGHLIGHT_COLORS);
export type HighlightColor = z.infer<typeof HighlightColorSchema>;

export const SourceTypeSchema = z.enum(["webpage", "pdf"]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

/** A rectangle normalised to the page box (0..1), used for PDF geometry. */
export const RectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
export type NormRect = z.infer<typeof RectSchema>;

export const AnchorSchema = z.object({
  /** TextQuoteSelector: whitespace-normalised selected text and its context. */
  exact: z.string().min(1),
  prefix: z.string(),
  suffix: z.string(),
  /** TextPositionSelector: offsets into the normalised text of the page/PDF page. */
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().nonnegative().optional(),
  /** 1-based PDF page number. */
  pageNumber: z.number().int().positive().optional(),
  /** PDF selection geometry, normalised to the page. */
  rects: z.array(RectSchema).optional(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

export const HighlightSchema = z.object({
  id: z.string().min(1),
  source: z.object({
    type: SourceTypeSchema,
    documentId: z.string().min(1),
    url: z.string(),
    title: z.string(),
  }),
  anchor: AnchorSchema,
  color: HighlightColorSchema,
  note: z.string().optional(),
  collectionIds: z.array(z.string()),
  /** Tag ids. */
  tags: z.array(z.string()),
  favorite: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.number().optional(),
});
export type Highlight = z.infer<typeof HighlightSchema>;

export const DocumentSchema = z.object({
  id: z.string().min(1),
  type: SourceTypeSchema,
  url: z.string().optional(),
  title: z.string(),
  favicon: z.string().optional(),
  fingerprint: z.string().optional(),
  pageCount: z.number().optional(),
  /** True when the PDF bytes were imported and live in the local pdfFiles table. */
  localFile: z.boolean().optional(),
  lastOpenedAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.number().optional(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const CollectionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.number().optional(),
});
export type Collection = z.infer<typeof CollectionSchema>;

export const TagSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  deletedAt: z.number().optional(),
});
export type Tag = z.infer<typeof TagSchema>;

export type EntityType = "highlight" | "document" | "collection" | "tag";
export const ENTITY_TYPES: EntityType[] = ["highlight", "document", "collection", "tag"];

/** A pending local change that has not been pushed to Google Drive yet. */
export interface SyncOperation {
  id: string;
  entityType: EntityType;
  entityId: string;
  operation: "upsert" | "delete";
  timestamp: number;
  deviceId: string;
}

export interface SyncMetadata {
  key: string;
  value: unknown;
}

export interface PdfFile {
  documentId: string;
  name: string;
  blob: Blob;
  size: number;
  addedAt: number;
  /** Drive file id once the original has been backed up (opt-in). */
  driveFileId?: string;
}

/** The portable shape used for export/import and for Drive sync payloads. */
export const DataBundleSchema = z.object({
  format: z.literal("web-pdf-highlighter"),
  version: z.literal(1),
  exportedAt: z.number(),
  deviceId: z.string().optional(),
  highlights: z.array(HighlightSchema).default([]),
  documents: z.array(DocumentSchema).default([]),
  collections: z.array(CollectionSchema).default([]),
  tags: z.array(TagSchema).default([]),
});
export type DataBundle = z.infer<typeof DataBundleSchema>;
