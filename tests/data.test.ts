import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/shared/db";
import { bundleToMarkdown, exportBundle, incomingWins, mergeBundle } from "../src/shared/merge";
import { createCollection, createHighlight, createTag, deleteCollection, deleteHighlights, highlightsForDocument, updateHighlight } from "../src/shared/repo";
import { colorHex, colorLabel, colorWithAlpha, toCustomColor } from "../src/shared/colors";
import { DataBundleSchema, HighlightColorSchema, type Highlight } from "../src/shared/types";
import { isPdfUrl, normalizeUrl } from "../src/shared/util";
import { EMPTY_FILTERS, filterHighlights } from "../src/pages/dashboard/search";

const doc = { id: "web:https://example.com/a", type: "webpage" as const, title: "Example A", url: "https://example.com/a" };
const anchor = (exact: string) => ({ exact, prefix: "", suffix: "", start: 0, end: exact.length });

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe("repository", () => {
  it("stores a highlight, its document and a pending sync operation", async () => {
    const h = await createHighlight({ document: doc, anchor: anchor("hello world"), color: "green", note: "  n  " });
    expect(h.note).toBe("n");
    expect((await db.documents.get(doc.id))?.title).toBe("Example A");
    const ops = await db.syncQueue.toArray();
    expect(ops.map((o) => o.entityType).sort()).toEqual(["document", "highlight"]);
  });

  it("coalesces repeated edits into one pending operation", async () => {
    const h = await createHighlight({ document: doc, anchor: anchor("x"), color: "yellow" });
    await updateHighlight(h.id, { color: "blue" });
    await updateHighlight(h.id, { note: "later" });
    expect(await db.syncQueue.where("[entityType+entityId]").equals(["highlight", h.id]).count()).toBe(1);
  });

  it("soft-deletes so the deletion can sync", async () => {
    const h = await createHighlight({ document: doc, anchor: anchor("x"), color: "yellow" });
    await deleteHighlights([h.id]);
    expect(await highlightsForDocument(doc.id)).toEqual([]);
    expect((await db.highlights.get(h.id))?.deletedAt).toBeTypeOf("number");
  });

  it("removes a deleted collection from its highlights", async () => {
    const h = await createHighlight({ document: doc, anchor: anchor("x"), color: "yellow" });
    const c = await createCollection("System Design");
    await updateHighlight(h.id, { collectionIds: [c.id] });
    await deleteCollection(c.id);
    expect((await db.highlights.get(h.id))?.collectionIds).toEqual([]);
  });

  it("reuses an existing tag regardless of case", async () => {
    const a = await createTag("Kafka");
    expect((await createTag("kafka")).id).toBe(a.id);
  });
});

describe("merge", () => {
  const base: Highlight = {
    id: "h1", source: { type: "webpage", documentId: doc.id, url: doc.url, title: doc.title }, anchor: anchor("text"),
    color: "yellow", collectionIds: [], tags: [], favorite: false, createdAt: 1, updatedAt: 100,
  };
  const bundle = (h: Highlight) => ({ highlights: [h], documents: [], collections: [], tags: [] });

  it("keeps the newer copy (last writer wins) and preserves notes", async () => {
    await db.highlights.put({ ...base, note: "local note", updatedAt: 200 });
    await mergeBundle(bundle({ ...base, color: "pink", updatedAt: 150 }));
    expect(await db.highlights.get("h1")).toMatchObject({ color: "yellow", note: "local note" });
    await mergeBundle(bundle({ ...base, color: "pink", note: "remote note", updatedAt: 250 }));
    expect(await db.highlights.get("h1")).toMatchObject({ color: "pink", note: "remote note" });
  });

  it("applies remote deletions and is idempotent", async () => {
    await db.highlights.put(base);
    const tombstone = { ...base, updatedAt: 300, deletedAt: 300 };
    expect((await mergeBundle(bundle(tombstone))).applied).toBe(1);
    expect((await mergeBundle(bundle(tombstone))).applied).toBe(0);
    expect((await db.highlights.get("h1"))?.deletedAt).toBe(300);
  });

  it("does not resurrect a highlight deleted later than the incoming edit", async () => {
    await db.highlights.put({ ...base, updatedAt: 300, deletedAt: 300 });
    await mergeBundle(bundle({ ...base, note: "stale edit", updatedAt: 200 }));
    expect((await db.highlights.get("h1"))?.deletedAt).toBe(300);
  });

  it("lets a tombstone win an exact tie", () => {
    expect(incomingWins(base, { ...base, deletedAt: 100 })).toBe(true);
    expect(incomingWins({ ...base, deletedAt: 100 }, base)).toBe(false);
  });
});

describe("export / import", () => {
  it("round-trips through the validated bundle format", async () => {
    const h = await createHighlight({ document: doc, anchor: anchor("portable data"), color: "orange", note: "keep me" });
    const tag = await createTag("export");
    await updateHighlight(h.id, { tags: [tag.id] });
    const json = JSON.parse(JSON.stringify(await exportBundle()));
    const parsed = DataBundleSchema.parse(json);
    await Promise.all(db.tables.map((t) => t.clear()));
    await mergeBundle(parsed);
    expect((await highlightsForDocument(doc.id))[0]).toMatchObject({ note: "keep me", tags: [tag.id] });
    expect(bundleToMarkdown(parsed)).toContain("> portable data");
    expect(bundleToMarkdown(parsed)).toContain("#export");
  });

  it("rejects files in another format", () => {
    expect(DataBundleSchema.safeParse({ highlights: [] }).success).toBe(false);
    expect(DataBundleSchema.safeParse({ format: "web-pdf-highlighter", version: 1, exportedAt: 1, highlights: [{ id: "x" }] }).success).toBe(false);
  });
});

describe("search and filters", () => {
  const mk = (id: string, patch: Partial<Highlight>): Highlight => ({
    id, source: { type: "webpage", documentId: "d", url: "https://news.example.org/post", title: "Post" }, anchor: anchor("text " + id),
    color: "yellow", collectionIds: [], tags: [], favorite: false, createdAt: 1, updatedAt: 1, ...patch,
  });
  const all = [
    mk("a", { anchor: anchor("Raft consensus"), tags: ["t1"], createdAt: 30, updatedAt: 30 }),
    mk("b", { note: "about consensus too", color: "blue", favorite: true, createdAt: 20, updatedAt: 90 }),
    mk("c", { source: { type: "pdf", documentId: "p", url: "", title: "Paper.pdf" }, collectionIds: ["c1"], createdAt: 10, updatedAt: 10 }),
    mk("d", { deletedAt: 5 }),
  ];
  const names = { tags: new Map([["t1", "distributed"]]), collections: new Map([["c1", "Research Papers"]]) };
  const ids = (f: Partial<typeof EMPTY_FILTERS>) => filterHighlights(all, { ...EMPTY_FILTERS, ...f }, names).map((h) => h.id);

  it("searches text, notes, tag names and collection names", () => {
    expect(ids({ query: "consensus" })).toEqual(["a", "b"]);
    expect(ids({ query: "DISTRIBUTED" })).toEqual(["a"]);
    expect(ids({ query: "research papers" })).toEqual(["c"]);
    expect(ids({ query: "example.org raft" })).toEqual(["a"]);
  });

  it("filters and sorts, never returning deleted highlights", () => {
    expect(ids({})).toEqual(["a", "b", "c"]);
    expect(ids({ sort: "oldest" })).toEqual(["c", "b", "a"]);
    expect(ids({ sort: "updated" })).toEqual(["b", "a", "c"]);
    expect(ids({ sourceType: "pdf" })).toEqual(["c"]);
    expect(ids({ colors: ["blue"] })).toEqual(["b"]);
    expect(ids({ favoritesOnly: true })).toEqual(["b"]);
    expect(ids({ domain: "news.example.org" })).toEqual(["a", "b"]);
    expect(ids({ collectionId: "c1" })).toEqual(["c"]);
    expect(ids({ tagIds: ["t1"] })).toEqual(["a"]);
  });
});

describe("urls", () => {
  it("normalises tracking parameters and fragments but keeps hash routes", () => {
    expect(normalizeUrl("https://a.com/x/?utm_source=n&b=2&a=1#top")).toBe("https://a.com/x?a=1&b=2");
    expect(normalizeUrl("https://a.com/app#/inbox/3")).toBe("https://a.com/app#/inbox/3");
  });
  it("recognises PDF urls", () => {
    expect(isPdfUrl("https://a.com/paper.PDF?dl=1")).toBe(true);
    expect(isPdfUrl("https://a.com/paper.pdf.html")).toBe(false);
    expect(isPdfUrl("chrome-extension://abc/pdf/index.html?src=x.pdf")).toBe(false);
  });
});

describe("custom colors", () => {
  it("accepts presets and #rrggbb, normalising case, and rejects anything else", () => {
    expect(HighlightColorSchema.parse("green")).toBe("green");
    expect(HighlightColorSchema.parse("#12ABef")).toBe("#12abef");
    for (const bad of ["teal", "#fff", "#12345g", "rgb(1,2,3)", ""]) expect(HighlightColorSchema.safeParse(bad).success).toBe(false);
    expect(toCustomColor(" #AABBCC ")).toBe("#aabbcc");
    expect(toCustomColor("red")).toBeNull();
  });

  it("resolves hex, label and alpha for both kinds", () => {
    expect(colorHex("yellow")).toBe("#fde047");
    expect(colorHex("#102030")).toBe("#102030");
    expect(colorLabel("blue")).toBe("Blue");
    expect(colorLabel("#102030")).toBe("#102030");
    expect(colorWithAlpha("#102030", 0.5)).toBe("rgba(16, 32, 48, 0.5)");
  });

  it("stores, filters and exports a custom-colored highlight", async () => {
    const h = await createHighlight({ document: doc, anchor: anchor("teal text"), color: "#14b8a6" });
    await createHighlight({ document: doc, anchor: anchor("plain"), color: "yellow" });
    const all = await highlightsForDocument(doc.id);
    expect(filterHighlights(all, { ...EMPTY_FILTERS, colors: ["#14b8a6"] }, { tags: new Map(), collections: new Map() }).map((x) => x.id)).toEqual([h.id]);
    const parsed = DataBundleSchema.parse(JSON.parse(JSON.stringify(await exportBundle())));
    expect(parsed.highlights.map((x) => x.color).sort()).toEqual(["#14b8a6", "yellow"]);
  });
});
