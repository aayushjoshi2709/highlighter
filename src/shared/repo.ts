import { db } from "./db";
import { CHANGE_KEY, type ChangeNotice } from "./prefs";
import type {
  Anchor, Collection, Document, EntityType, Highlight, HighlightColor, SourceType, SyncOperation, Tag,
} from "./types";
import { newId } from "./util";

/**
 * All writes go through this module. Each write is a single IndexedDB
 * transaction that also records a pending sync operation, so a change is
 * durable locally before any network activity happens.
 */

export async function getDeviceId(): Promise<string> {
  const row = await db.syncMetadata.get("deviceId");
  if (row) return row.value as string;
  const id = newId();
  await db.syncMetadata.put({ key: "deviceId", value: id });
  return id;
}

async function enqueue(entityType: EntityType, entityId: string, operation: SyncOperation["operation"]) {
  const deviceId = await getDeviceId();
  // Coalesce: one pending operation per entity is enough, the payload is read at push time.
  await db.syncQueue.where("[entityType+entityId]").equals([entityType, entityId]).delete();
  await db.syncQueue.put({ id: newId(), entityType, entityId, operation, timestamp: Date.now(), deviceId });
}

export function notifyChange(documentIds: string[], origin: ChangeNotice["origin"] = "local") {
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  const notice: ChangeNotice = { at: Date.now(), documentIds: [...new Set(documentIds)], origin };
  void chrome.storage.local.set({ [CHANGE_KEY]: notice });
}

const tx = <T>(fn: () => Promise<T>) =>
  db.transaction("rw", [db.highlights, db.documents, db.collections, db.tags, db.syncQueue, db.syncMetadata], fn);

// ---------------------------------------------------------------- documents

export interface DocumentInput {
  id: string;
  type: SourceType;
  title: string;
  url?: string;
  favicon?: string;
  fingerprint?: string;
  pageCount?: number;
  localFile?: boolean;
}

/** Creates the document or refreshes its metadata. Does not sync a mere "opened" touch. */
export async function upsertDocument(input: DocumentInput, opts: { opened?: boolean } = {}): Promise<Document> {
  return tx(async () => {
    const now = Date.now();
    const existing = await db.documents.get(input.id);
    if (!existing || existing.deletedAt) {
      const doc: Document = { ...input, createdAt: now, updatedAt: now, lastOpenedAt: opts.opened ? now : undefined };
      await db.documents.put(doc);
      await enqueue("document", doc.id, "upsert");
      return doc;
    }
    const changed =
      (input.title && input.title !== existing.title) ||
      (input.favicon && input.favicon !== existing.favicon) ||
      (input.pageCount && input.pageCount !== existing.pageCount) ||
      (input.url && input.url !== existing.url) ||
      (input.localFile && !existing.localFile);
    const doc: Document = {
      ...existing,
      title: input.title || existing.title,
      url: input.url ?? existing.url,
      favicon: input.favicon ?? existing.favicon,
      pageCount: input.pageCount ?? existing.pageCount,
      localFile: input.localFile ?? existing.localFile,
      fingerprint: input.fingerprint ?? existing.fingerprint,
      lastOpenedAt: opts.opened ? now : existing.lastOpenedAt,
      updatedAt: changed ? now : existing.updatedAt,
    };
    await db.documents.put(doc);
    if (changed) await enqueue("document", doc.id, "upsert");
    return doc;
  });
}

export async function deleteDocument(id: string): Promise<void> {
  await tx(async () => {
    const now = Date.now();
    const doc = await db.documents.get(id);
    if (doc) {
      await db.documents.put({ ...doc, deletedAt: now, updatedAt: now });
      await enqueue("document", id, "delete");
    }
    const hs = await db.highlights.where("source.documentId").equals(id).toArray();
    for (const h of hs) {
      if (h.deletedAt) continue;
      await db.highlights.put({ ...h, deletedAt: now, updatedAt: now });
      await enqueue("highlight", h.id, "delete");
    }
  });
  await db.pdfFiles.delete(id);
  notifyChange([id]);
}

// --------------------------------------------------------------- highlights

export interface NewHighlight {
  document: DocumentInput;
  anchor: Anchor;
  color: HighlightColor;
  note?: string;
}

export async function createHighlight(input: NewHighlight): Promise<Highlight> {
  const doc = await upsertDocument(input.document);
  const now = Date.now();
  const h: Highlight = {
    id: newId(),
    source: { type: doc.type, documentId: doc.id, url: doc.url ?? "", title: doc.title },
    anchor: input.anchor,
    color: input.color,
    note: input.note?.trim() || undefined,
    collectionIds: [],
    tags: [],
    favorite: false,
    createdAt: now,
    updatedAt: now,
  };
  await tx(async () => {
    await db.highlights.put(h);
    await enqueue("highlight", h.id, "upsert");
  });
  notifyChange([doc.id]);
  return h;
}

export type HighlightPatch = Partial<Pick<Highlight, "color" | "note" | "favorite" | "collectionIds" | "tags" | "anchor">>;

export async function updateHighlights(ids: string[], patch: HighlightPatch | ((h: Highlight) => HighlightPatch)) {
  const docIds: string[] = [];
  await tx(async () => {
    const now = Date.now();
    for (const id of ids) {
      const h = await db.highlights.get(id);
      if (!h || h.deletedAt) continue;
      const p = typeof patch === "function" ? patch(h) : patch;
      const next: Highlight = { ...h, ...p, updatedAt: now };
      if ("note" in p) next.note = p.note?.trim() || undefined;
      await db.highlights.put(next);
      await enqueue("highlight", id, "upsert");
      docIds.push(h.source.documentId);
    }
  });
  notifyChange(docIds);
}

export const updateHighlight = (id: string, patch: HighlightPatch) => updateHighlights([id], patch);

export async function deleteHighlights(ids: string[]) {
  const docIds: string[] = [];
  await tx(async () => {
    const now = Date.now();
    for (const id of ids) {
      const h = await db.highlights.get(id);
      if (!h || h.deletedAt) continue;
      // Soft delete: the tombstone is what propagates the deletion to other devices.
      await db.highlights.put({ ...h, deletedAt: now, updatedAt: now });
      await enqueue("highlight", id, "delete");
      docIds.push(h.source.documentId);
    }
  });
  notifyChange(docIds);
}

export async function highlightsForDocument(documentId: string): Promise<Highlight[]> {
  const hs = await db.highlights.where("source.documentId").equals(documentId).toArray();
  return hs.filter((h) => !h.deletedAt).sort((a, b) => a.createdAt - b.createdAt);
}

// ------------------------------------------------------ collections & tags

export async function createCollection(name: string, description?: string): Promise<Collection> {
  const now = Date.now();
  const c: Collection = { id: newId(), name: name.trim(), description: description?.trim() || undefined, createdAt: now, updatedAt: now };
  await tx(async () => {
    await db.collections.put(c);
    await enqueue("collection", c.id, "upsert");
  });
  notifyChange([]);
  return c;
}

export async function updateCollection(id: string, patch: Partial<Pick<Collection, "name" | "description">>) {
  await tx(async () => {
    const c = await db.collections.get(id);
    if (!c || c.deletedAt) return;
    await db.collections.put({ ...c, ...patch, updatedAt: Date.now() });
    await enqueue("collection", id, "upsert");
  });
  notifyChange([]);
}

export async function deleteCollection(id: string) {
  await tx(async () => {
    const now = Date.now();
    const c = await db.collections.get(id);
    if (c) {
      await db.collections.put({ ...c, deletedAt: now, updatedAt: now });
      await enqueue("collection", id, "delete");
    }
    const hs = await db.highlights.where("collectionIds").equals(id).toArray();
    for (const h of hs) {
      await db.highlights.put({ ...h, collectionIds: h.collectionIds.filter((x) => x !== id), updatedAt: now });
      await enqueue("highlight", h.id, "upsert");
    }
  });
  notifyChange([]);
}

export async function createTag(name: string): Promise<Tag> {
  const clean = name.trim();
  const existing = (await db.tags.toArray()).find((t) => !t.deletedAt && t.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const now = Date.now();
  const t: Tag = { id: newId(), name: clean, createdAt: now, updatedAt: now };
  await tx(async () => {
    await db.tags.put(t);
    await enqueue("tag", t.id, "upsert");
  });
  notifyChange([]);
  return t;
}

export async function renameTag(id: string, name: string) {
  await tx(async () => {
    const t = await db.tags.get(id);
    if (!t || t.deletedAt) return;
    await db.tags.put({ ...t, name: name.trim(), updatedAt: Date.now() });
    await enqueue("tag", id, "upsert");
  });
  notifyChange([]);
}

export async function deleteTag(id: string) {
  await tx(async () => {
    const now = Date.now();
    const t = await db.tags.get(id);
    if (t) {
      await db.tags.put({ ...t, deletedAt: now, updatedAt: now });
      await enqueue("tag", id, "delete");
    }
    const hs = await db.highlights.where("tags").equals(id).toArray();
    for (const h of hs) {
      await db.highlights.put({ ...h, tags: h.tags.filter((x) => x !== id), updatedAt: now });
      await enqueue("highlight", h.id, "upsert");
    }
  });
  notifyChange([]);
}
