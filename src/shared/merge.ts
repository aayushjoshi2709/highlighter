import { db } from "./db";
import type { Collection, DataBundle, Document, EntityType, Highlight, Tag } from "./types";

type Entity = Highlight | Document | Collection | Tag;

/**
 * Last-writer-wins by `updatedAt`. Deletions are tombstones (`deletedAt`), so
 * they compete like any other write; on an exact tie the tombstone wins so
 * every device converges on the same result.
 */
export function incomingWins(local: Entity | undefined, incoming: Entity): boolean {
  if (!local) return true;
  if (incoming.updatedAt !== local.updatedAt) return incoming.updatedAt > local.updatedAt;
  return Boolean(incoming.deletedAt) && !local.deletedAt;
}

export interface MergeResult {
  applied: number;
  documentIds: string[];
  /** Entities where the incoming copy won, per type. */
  changed: Record<EntityType, string[]>;
}

/**
 * Merges a bundle (from Drive or from an import file) into the local database.
 * Idempotent: applying the same bundle twice is a no-op the second time.
 */
export async function mergeBundle(bundle: Pick<DataBundle, "highlights" | "documents" | "collections" | "tags">): Promise<MergeResult> {
  const result: MergeResult = { applied: 0, documentIds: [], changed: { highlight: [], document: [], collection: [], tag: [] } };
  await db.transaction("rw", [db.highlights, db.documents, db.collections, db.tags], async () => {
    const run = async <T extends Entity>(type: EntityType, table: import("dexie").Table<T, string>, items: T[]) => {
      for (const incoming of items) {
        const local = await table.get(incoming.id);
        if (!incomingWins(local, incoming)) continue;
        let next = incoming;
        if (type === "document" && local) {
          // Device-local facts are never overwritten by another device.
          const l = local as Document;
          next = { ...incoming, localFile: l.localFile, lastOpenedAt: l.lastOpenedAt } as T;
        } else if (type === "document") {
          next = { ...incoming, localFile: undefined } as T;
        }
        await table.put(next);
        result.applied++;
        result.changed[type].push(incoming.id);
        if (type === "highlight") result.documentIds.push((incoming as Highlight).source.documentId);
      }
    };
    await run("document", db.documents, bundle.documents);
    await run("collection", db.collections, bundle.collections);
    await run("tag", db.tags, bundle.tags);
    await run("highlight", db.highlights, bundle.highlights);
  });
  return result;
}

export async function exportBundle(highlightIds?: string[]): Promise<DataBundle> {
  const all = await db.highlights.toArray();
  const highlights = all.filter((h) => !h.deletedAt && (!highlightIds || highlightIds.includes(h.id)));
  const docIds = new Set(highlights.map((h) => h.source.documentId));
  const colIds = new Set(highlights.flatMap((h) => h.collectionIds));
  const tagIds = new Set(highlights.flatMap((h) => h.tags));
  const partial = Boolean(highlightIds);
  return {
    format: "web-pdf-highlighter",
    version: 1,
    exportedAt: Date.now(),
    highlights,
    documents: (await db.documents.toArray()).filter((d) => !d.deletedAt && (!partial || docIds.has(d.id))),
    collections: (await db.collections.toArray()).filter((c) => !c.deletedAt && (!partial || colIds.has(c.id))),
    tags: (await db.tags.toArray()).filter((t) => !t.deletedAt && (!partial || tagIds.has(t.id))),
  };
}

export function bundleToMarkdown(bundle: DataBundle): string {
  const tagName = new Map(bundle.tags.map((t) => [t.id, t.name]));
  const byDoc = new Map<string, Highlight[]>();
  for (const h of bundle.highlights) {
    const list = byDoc.get(h.source.documentId) ?? [];
    list.push(h);
    byDoc.set(h.source.documentId, list);
  }
  const out: string[] = ["# Highlights", ""];
  for (const hs of byDoc.values()) {
    const s = hs[0].source;
    out.push(`## ${s.title || s.url}`, "");
    if (s.url) out.push(`<${s.url}>`, "");
    for (const h of hs.sort((a, b) => (a.anchor.pageNumber ?? 0) - (b.anchor.pageNumber ?? 0) || a.createdAt - b.createdAt)) {
      const page = h.anchor.pageNumber ? ` (p. ${h.anchor.pageNumber})` : "";
      out.push(`> ${h.anchor.exact}${page}`, "");
      if (h.note) out.push(`**Note:** ${h.note}`, "");
      const tags = h.tags.map((t) => tagName.get(t)).filter(Boolean);
      if (tags.length) out.push(tags.map((t) => `#${t}`).join(" "), "");
    }
  }
  return out.join("\n");
}
