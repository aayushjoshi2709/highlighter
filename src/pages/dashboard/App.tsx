import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { db } from "../../shared/db";
import type { Collection, Document, Highlight, Tag } from "../../shared/types";
import { SyncDot } from "../../ui/common";
import { Collections } from "./Collections";
import { Documents } from "./Documents";
import { HighlightList } from "./HighlightList";
import { Settings } from "./Settings";
import { SECTIONS, useDashboard } from "./store";

export interface Data {
  highlights: Highlight[];
  documents: Document[];
  collections: Collection[];
  tags: Tag[];
}

const alive = <T extends { deletedAt?: number }>(rows: T[] | undefined) => (rows ?? []).filter((r) => !r.deletedAt);

function useData(): Data {
  const highlights = useLiveQuery(() => db.highlights.toArray(), []);
  const documents = useLiveQuery(() => db.documents.toArray(), []);
  const collections = useLiveQuery(() => db.collections.toArray(), []);
  const tags = useLiveQuery(() => db.tags.toArray(), []);
  return useMemo(
    () => ({
      highlights: alive(highlights),
      documents: alive(documents),
      collections: alive(collections).sort((a, b) => a.name.localeCompare(b.name)),
      tags: alive(tags).sort((a, b) => a.name.localeCompare(b.name)),
    }),
    [highlights, documents, collections, tags],
  );
}

export function App() {
  const data = useData();
  const { section, go } = useDashboard();
  const counts: Record<string, number> = {
    all: data.highlights.length,
    web: data.highlights.filter((h) => h.source.type === "webpage").length,
    pdf: data.highlights.filter((h) => h.source.type === "pdf").length,
    favorites: data.highlights.filter((h) => h.favorite).length,
    collections: data.collections.length,
    documents: data.documents.length,
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-800">
      <nav className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-4 py-4">
          <img src="../icons/icon48.png" alt="" className="h-7 w-7" />
          <span className="font-semibold">Highlighter</span>
        </div>
        <ul className="flex-1 px-2">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => go(s.id, {})}
                aria-current={section === s.id ? "page" : undefined}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${
                  section === s.id ? "bg-blue-50 font-medium text-blue-700" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {s.label}
                {counts[s.id] !== undefined && <span className="text-xs text-slate-400">{counts[s.id]}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-slate-200 px-4 py-3">
          <SyncDot />
        </div>
      </nav>

      <main className="min-w-0 flex-1 overflow-auto">
        {(section === "all" || section === "web" || section === "pdf" || section === "favorites") && <HighlightList data={data} section={section} />}
        {section === "collections" && <Collections data={data} />}
        {section === "documents" && <Documents data={data} />}
        {section === "settings" && <Settings />}
      </main>
    </div>
  );
}
