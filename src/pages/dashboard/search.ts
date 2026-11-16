import type { Highlight, HighlightColor, SourceType } from "../../shared/types";
import { domainOf } from "../../shared/util";

export type SortOrder = "newest" | "oldest" | "updated" | "title";

export interface Filters {
  query: string;
  colors: HighlightColor[];
  sourceType: SourceType | null;
  domain: string | null;
  documentId: string | null;
  collectionId: string | null;
  tagIds: string[];
  favoritesOnly: boolean;
  /** Inclusive day bounds as "YYYY-MM-DD". */
  from: string;
  to: string;
  sort: SortOrder;
}

export const EMPTY_FILTERS: Filters = {
  query: "",
  colors: [],
  sourceType: null,
  domain: null,
  documentId: null,
  collectionId: null,
  tagIds: [],
  favoritesOnly: false,
  from: "",
  to: "",
  sort: "newest",
};

export interface Names {
  tags: Map<string, string>;
  collections: Map<string, string>;
}

function haystack(h: Highlight, names: Names): string {
  return [
    h.anchor.exact,
    h.note ?? "",
    h.source.title,
    h.source.url,
    ...h.tags.map((t) => names.tags.get(t) ?? ""),
    ...h.collectionIds.map((c) => names.collections.get(c) ?? ""),
  ]
    .join("\n")
    .toLowerCase();
}

const dayStart = (d: string) => new Date(`${d}T00:00:00`).getTime();
const dayEnd = (d: string) => new Date(`${d}T23:59:59.999`).getTime();

/** Local full-text search (every term must match) plus filters and sorting. */
export function filterHighlights(all: Highlight[], f: Filters, names: Names): Highlight[] {
  const terms = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  const from = f.from ? dayStart(f.from) : -Infinity;
  const to = f.to ? dayEnd(f.to) : Infinity;

  const out = all.filter((h) => {
    if (h.deletedAt) return false;
    if (f.sourceType && h.source.type !== f.sourceType) return false;
    if (f.favoritesOnly && !h.favorite) return false;
    if (f.colors.length && !f.colors.includes(h.color)) return false;
    if (f.documentId && h.source.documentId !== f.documentId) return false;
    if (f.domain && domainOf(h.source.url) !== f.domain) return false;
    if (f.collectionId && !h.collectionIds.includes(f.collectionId)) return false;
    if (f.tagIds.length && !f.tagIds.every((t) => h.tags.includes(t))) return false;
    if (h.createdAt < from || h.createdAt > to) return false;
    if (terms.length) {
      const text = haystack(h, names);
      if (!terms.every((t) => text.includes(t))) return false;
    }
    return true;
  });

  const cmp: Record<SortOrder, (a: Highlight, b: Highlight) => number> = {
    newest: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    updated: (a, b) => b.updatedAt - a.updatedAt,
    title: (a, b) => a.source.title.localeCompare(b.source.title) || b.createdAt - a.createdAt,
  };
  return out.sort(cmp[f.sort]);
}
