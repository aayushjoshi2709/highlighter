import { useMemo, useState } from "react";
import { colorHex, colorLabel, colorWithAlpha, isPresetColor } from "../../shared/colors";
import { openHighlightSource } from "../../shared/open";
import { createTag, deleteHighlights, updateHighlight, updateHighlights } from "../../shared/repo";
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor } from "../../shared/types";
import { domainOf, formatDate } from "../../shared/util";
import { Swatches } from "../../ui/common";
import type { Data } from "./App";
import { exportJson, exportMarkdown } from "./io";
import { EMPTY_FILTERS, filterHighlights, type Filters, type SortOrder } from "./search";
import { SECTIONS, useDashboard, type Section } from "./store";

const PAGE_SIZE = 100;

export function HighlightList({ data, section }: { data: Data; section: Section }) {
  const { filters, setFilters, resetFilters, selected, toggleSelected, setSelected } = useDashboard();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [showFilters, setShowFilters] = useState(false);

  const names = useMemo(
    () => ({
      tags: new Map(data.tags.map((t) => [t.id, t.name])),
      collections: new Map(data.collections.map((c) => [c.id, c.name])),
    }),
    [data.tags, data.collections],
  );

  // The section pins part of the filter; the rest is user-controlled.
  const effective: Filters = useMemo(
    () => ({
      ...filters,
      sourceType: section === "web" ? "webpage" : section === "pdf" ? "pdf" : filters.sourceType,
      favoritesOnly: section === "favorites" ? true : filters.favoritesOnly,
    }),
    [filters, section],
  );
  const results = useMemo(() => filterHighlights(data.highlights, effective, names), [data.highlights, effective, names]);
  // The six presets, then every custom colour currently in use.
  const filterColors = useMemo<HighlightColor[]>(
    () => [...HIGHLIGHT_COLORS, ...[...new Set(data.highlights.map((h) => h.color).filter((c) => !isPresetColor(c)))].sort()],
    [data.highlights],
  );
  const domains = useMemo(() => [...new Set(data.highlights.map((h) => domainOf(h.source.url)).filter(Boolean))].sort(), [data.highlights]);

  const selectedIds = results.filter((h) => selected.has(h.id)).map((h) => h.id);
  const activeFilters =
    filters.colors.length + filters.tagIds.length +
    [filters.sourceType, filters.domain, filters.documentId, filters.collectionId, filters.from, filters.to, filters.favoritesOnly].filter(Boolean).length;
  const title = SECTIONS.find((s) => s.id === section)!.label;

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <span className="text-sm text-slate-400">{results.length} of {data.highlights.length}</span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          className="input min-w-0 flex-1"
          placeholder="Search text, notes, titles, URLs, tags, collections…"
          value={filters.query}
          onChange={(e) => {
            setFilters({ query: e.target.value });
            setLimit(PAGE_SIZE);
          }}
        />
        <button className="btn" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          Filters{activeFilters ? ` (${activeFilters})` : ""}
        </button>
        <select className="input" value={filters.sort} onChange={(e) => setFilters({ sort: e.target.value as SortOrder })} aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="updated">Recently updated</option>
          <option value="title">Source title</option>
        </select>
      </div>

      {showFilters && (
        <div className="mb-3 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm md:grid-cols-3">
          <div className="col-span-2 md:col-span-3">
            <div className="mb-1 text-xs font-medium text-slate-500">Color</div>
            <div className="flex flex-wrap gap-2">
              {filterColors.map((c) => {
                const on = filters.colors.includes(c);
                return (
                  <button
                    key={c}
                    aria-pressed={on}
                    onClick={() => setFilters({ colors: on ? filters.colors.filter((x) => x !== c) : [...filters.colors, c] })}
                    className={`chip border ${on ? "border-slate-700" : "border-transparent"}`}
                  >
                    <span className="h-3 w-3 rounded-full" style={{ background: colorHex(c) }} />
                    {colorLabel(c)}
                  </button>
                );
              })}
            </div>
          </div>
          {section !== "web" && section !== "pdf" && (
            <Select label="Source type" value={filters.sourceType ?? ""} onChange={(v) => setFilters({ sourceType: (v || null) as Filters["sourceType"] })}
              options={[["", "Any"], ["webpage", "Webpage"], ["pdf", "PDF"]]} />
          )}
          <Select label="Domain" value={filters.domain ?? ""} onChange={(v) => setFilters({ domain: v || null })}
            options={[["", "Any"], ...domains.map((d) => [d, d] as [string, string])]} />
          <Select label="Document" value={filters.documentId ?? ""} onChange={(v) => setFilters({ documentId: v || null })}
            options={[["", "Any"], ...data.documents.map((d) => [d.id, d.title] as [string, string])]} />
          <Select label="Collection" value={filters.collectionId ?? ""} onChange={(v) => setFilters({ collectionId: v || null })}
            options={[["", "Any"], ...data.collections.map((c) => [c.id, c.name] as [string, string])]} />
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Created from</span>
            <input type="date" className="input w-full" value={filters.from} onChange={(e) => setFilters({ from: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Created to</span>
            <input type="date" className="input w-full" value={filters.to} onChange={(e) => setFilters({ to: e.target.value })} />
          </label>
          {data.tags.length > 0 && (
            <div className="col-span-2 md:col-span-3">
              <div className="mb-1 text-xs font-medium text-slate-500">Tags</div>
              <div className="flex flex-wrap gap-2">
                {data.tags.map((t) => {
                  const on = filters.tagIds.includes(t.id);
                  return (
                    <button key={t.id} aria-pressed={on} className={`chip border ${on ? "border-blue-600 bg-blue-50 text-blue-700" : "border-transparent"}`}
                      onClick={() => setFilters({ tagIds: on ? filters.tagIds.filter((x) => x !== t.id) : [...filters.tagIds, t.id] })}>
                      #{t.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="col-span-2 flex items-center justify-between md:col-span-3">
            {section !== "favorites" ? (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={filters.favoritesOnly} onChange={(e) => setFilters({ favoritesOnly: e.target.checked })} />
                Favorites only
              </label>
            ) : <span />}
            <button className="btn-ghost" onClick={resetFilters} disabled={!activeFilters && !filters.query}>Clear filters</button>
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2 text-slate-600">
          <input
            type="checkbox"
            checked={results.length > 0 && selectedIds.length === results.length}
            ref={(el) => {
              if (el) el.indeterminate = selectedIds.length > 0 && selectedIds.length < results.length;
            }}
            onChange={(e) => setSelected(e.target.checked ? results.map((h) => h.id) : [])}
          />
          {selectedIds.length ? `${selectedIds.length} selected` : "Select all"}
        </label>
        {selectedIds.length > 0 && (
          <>
            <button className="btn" onClick={() => void exportJson(selectedIds)}>Export JSON</button>
            <button className="btn" onClick={() => void exportMarkdown(selectedIds)}>Export Markdown</button>
            {data.collections.length > 0 && (
              <select
                className="input"
                value=""
                aria-label="Add selected to collection"
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) void updateHighlights(selectedIds, (h) => ({ collectionIds: [...new Set([...h.collectionIds, id])] }));
                }}
              >
                <option value="">Add to collection…</option>
                {data.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
            <button
              className="btn-danger"
              onClick={() => {
                if (confirm(`Delete ${selectedIds.length} highlight${selectedIds.length === 1 ? "" : "s"}?`)) {
                  void deleteHighlights(selectedIds);
                  setSelected([]);
                }
              }}
            >
              Delete
            </button>
          </>
        )}
      </div>

      {results.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          {data.highlights.length === 0
            ? "No highlights yet. Select text on any webpage or PDF and pick a color."
            : "No highlights match this search."}
          {data.highlights.length > 0 && JSON.stringify(filters) !== JSON.stringify({ ...EMPTY_FILTERS, sort: filters.sort }) && (
            <div className="mt-3"><button className="btn" onClick={resetFilters}>Clear search and filters</button></div>
          )}
        </div>
      )}

      <ul className="space-y-3">
        {results.slice(0, limit).map((h) => (
          <HighlightCard key={h.id} h={h} data={data} selected={selected.has(h.id)} onSelect={() => toggleSelected(h.id)} />
        ))}
      </ul>
      {results.length > limit && (
        <div className="mt-4 text-center">
          <button className="btn" onClick={() => setLimit((l) => l + PAGE_SIZE)}>Show more ({results.length - limit} remaining)</button>
        </div>
      )}
    </div>
  );
}

function Select(props: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-medium text-slate-500">{props.label}</span>
      <select className="input w-full" value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function HighlightCard({ h, data, selected, onSelect }: { h: Highlight; data: Data; selected: boolean; onSelect: () => void }) {
  const [editingNote, setEditingNote] = useState(false);
  const [note, setNote] = useState(h.note ?? "");
  const [organizing, setOrganizing] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [copied, setCopied] = useState(false);
  const doc = data.documents.find((d) => d.id === h.source.documentId);
  const tags = data.tags.filter((t) => h.tags.includes(t.id));
  const collections = data.collections.filter((c) => h.collectionIds.includes(c.id));
  const where = h.source.type === "pdf" ? (h.source.url ? domainOf(h.source.url) : "Imported PDF") : domainOf(h.source.url);

  const addTag = async () => {
    if (!newTag.trim()) return;
    const tag = await createTag(newTag);
    setNewTag("");
    if (!h.tags.includes(tag.id)) await updateHighlight(h.id, { tags: [...h.tags, tag.id] });
  };

  return (
    <li className={`rounded-lg border bg-white ${selected ? "border-blue-400 ring-1 ring-blue-400" : "border-slate-200"}`}>
      <div className="flex gap-3 p-4">
        <input type="checkbox" className="mt-1" checked={selected} onChange={onSelect} aria-label="Select highlight" />
        <div className="min-w-0 flex-1">
          <blockquote className="whitespace-pre-wrap break-words rounded border-l-4 px-3 py-2 text-[15px] leading-relaxed"
            style={{ borderColor: colorHex(h.color), background: colorWithAlpha(h.color, 0.22) }}>
            {h.anchor.exact}
          </blockquote>

          {editingNote ? (
            <div className="mt-2">
              <textarea className="input min-h-20 w-full" autoFocus value={note} placeholder="Add a note…" onChange={(e) => setNote(e.target.value)} />
              <div className="mt-1 flex justify-end gap-2">
                <button className="btn" onClick={() => { setNote(h.note ?? ""); setEditingNote(false); }}>Cancel</button>
                <button className="btn-primary" onClick={() => { void updateHighlight(h.id, { note }); setEditingNote(false); }}>Save note</button>
              </div>
            </div>
          ) : h.note ? (
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">📝 {h.note}</p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            {doc?.favicon && <img src={doc.favicon} alt="" className="h-4 w-4" onError={(e) => (e.currentTarget.style.display = "none")} />}
            <button className="max-w-xs truncate font-medium text-slate-700 hover:underline" title={h.source.url || h.source.title} onClick={() => openHighlightSource(h)}>
              {h.source.title || h.source.url}
            </button>
            <span>· {where}</span>
            {h.anchor.pageNumber && <span>· p. {h.anchor.pageNumber}</span>}
            <span>· {formatDate(h.createdAt)}</span>
            {tags.map((t) => <span key={t.id} className="chip">#{t.name}</span>)}
            {collections.map((c) => <span key={c.id} className="chip bg-blue-50 text-blue-700">{c.name}</span>)}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1">
            <Swatches value={h.color} onPick={(color) => void updateHighlight(h.id, { color })} size={16} />
            <span className="mx-1 h-4 w-px bg-slate-200" />
            <button className="btn-ghost" onClick={() => void updateHighlight(h.id, { favorite: !h.favorite })} aria-pressed={h.favorite}>
              {h.favorite ? "★ Favorited" : "☆ Favorite"}
            </button>
            <button className="btn-ghost" onClick={() => { setNote(h.note ?? ""); setEditingNote(true); }}>{h.note ? "Edit note" : "Add note"}</button>
            {h.note && <button className="btn-ghost" onClick={() => void updateHighlight(h.id, { note: "" })}>Remove note</button>}
            <button className="btn-ghost" onClick={() => setOrganizing((o) => !o)} aria-expanded={organizing}>Tags & collections</button>
            <button
              className="btn-ghost"
              onClick={() => void navigator.clipboard.writeText(h.anchor.exact).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button className="btn-ghost" onClick={() => openHighlightSource(h)}>{h.source.type === "pdf" ? "Open PDF" : "Open page"}</button>
            <button className="btn-ghost text-red-600" onClick={() => void deleteHighlights([h.id])}>Delete</button>
          </div>

          {organizing && (
            <div className="mt-3 grid gap-3 rounded-md bg-slate-50 p-3 text-sm md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-medium text-slate-500">Tags</div>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {data.tags.map((t) => {
                    const on = h.tags.includes(t.id);
                    return (
                      <button key={t.id} aria-pressed={on} className={`chip border ${on ? "border-blue-600 bg-blue-50 text-blue-700" : "border-transparent bg-white"}`}
                        onClick={() => void updateHighlight(h.id, { tags: on ? h.tags.filter((x) => x !== t.id) : [...h.tags, t.id] })}>
                        #{t.name}
                      </button>
                    );
                  })}
                </div>
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void addTag(); }}>
                  <input className="input min-w-0 flex-1" placeholder="New tag" value={newTag} onChange={(e) => setNewTag(e.target.value)} />
                  <button className="btn" disabled={!newTag.trim()}>Add</button>
                </form>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-slate-500">Collections</div>
                {data.collections.length === 0 && <p className="text-xs text-slate-500">Create collections in the Collections section.</p>}
                {data.collections.map((c) => {
                  const on = h.collectionIds.includes(c.id);
                  return (
                    <label key={c.id} className="flex items-center gap-2 py-0.5">
                      <input type="checkbox" checked={on}
                        onChange={() => void updateHighlight(h.id, { collectionIds: on ? h.collectionIds.filter((x) => x !== c.id) : [...h.collectionIds, c.id] })} />
                      {c.name}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
