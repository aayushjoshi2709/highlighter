import Dexie, { type Table } from "dexie";
import type { Collection, Document, Highlight, PdfFile, SyncMetadata, SyncOperation, Tag } from "./types";

/**
 * IndexedDB is the source of truth. It belongs to the extension origin, so the
 * service worker, popup, dashboard and PDF viewer all share it; content
 * scripts reach it through messages to the service worker.
 */
export class HighlighterDB extends Dexie {
  highlights!: Table<Highlight, string>;
  documents!: Table<Document, string>;
  collections!: Table<Collection, string>;
  tags!: Table<Tag, string>;
  syncQueue!: Table<SyncOperation, string>;
  syncMetadata!: Table<SyncMetadata, string>;
  pdfFiles!: Table<PdfFile, string>;

  constructor(name = "highlighter") {
    super(name);
    // Add new versions below (never edit a released one) to migrate the schema.
    this.version(1).stores({
      highlights: "id, source.documentId, source.type, color, createdAt, updatedAt, *collectionIds, *tags",
      documents: "id, type, url, fingerprint, updatedAt",
      collections: "id, name, updatedAt",
      tags: "id, name, updatedAt",
      syncQueue: "id, [entityType+entityId], timestamp",
      syncMetadata: "key",
      pdfFiles: "documentId",
    });
  }
}

export const db = new HighlighterDB();
