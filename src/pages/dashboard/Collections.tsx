import { useState } from "react";
import { createCollection, createTag, deleteCollection, deleteTag, renameTag, updateCollection } from "../../shared/repo";
import type { Collection, Tag } from "../../shared/types";
import type { Data } from "./App";
import { useDashboard } from "./store";

export function Collections({ data }: { data: Data }) {
  const go = useDashboard((s) => s.go);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagName, setTagName] = useState("");
  const count = (id: string) => data.highlights.filter((h) => h.collectionIds.includes(id)).length;
  const tagCount = (id: string) => data.highlights.filter((h) => h.tags.includes(id)).length;

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <h1 className="mb-4 text-xl font-semibold">Collections</h1>
      <form
        className="mb-4 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void createCollection(name, description);
          setName("");
          setDescription("");
        }}
      >
        <input className="input w-48" placeholder="Collection name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input min-w-0 flex-1" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <button className="btn-primary" disabled={!name.trim()}>Create</button>
      </form>

      {data.collections.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          Group highlights by topic, e.g. “System Design” or “Research Papers”.
        </p>
      )}
      <ul className="space-y-2">
        {data.collections.map((c) => (
          <CollectionRow key={c.id} c={c} count={count(c.id)} onOpen={() => go("all", { collectionId: c.id })} />
        ))}
      </ul>

      <h2 className="mb-3 mt-10 text-lg font-semibold">Tags</h2>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!tagName.trim()) return;
          void createTag(tagName);
          setTagName("");
        }}
      >
        <input className="input w-48" placeholder="New tag" value={tagName} onChange={(e) => setTagName(e.target.value)} />
        <button className="btn" disabled={!tagName.trim()}>Add tag</button>
      </form>
      {data.tags.length === 0 && <p className="text-sm text-slate-500">No tags yet.</p>}
      <ul className="space-y-1">
        {data.tags.map((t) => (
          <TagRow key={t.id} t={t} count={tagCount(t.id)} onOpen={() => go("all", { tagIds: [t.id] })} />
        ))}
      </ul>
    </div>
  );
}

function CollectionRow({ c, count, onOpen }: { c: Collection; count: number; onOpen: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(c.name);
  const [description, setDescription] = useState(c.description ?? "");

  if (editing) {
    return (
      <li>
        <form
          className="flex flex-wrap gap-2 rounded-lg border border-blue-300 bg-white p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            void updateCollection(c.id, { name: name.trim(), description: description.trim() || undefined });
            setEditing(false);
          }}
        >
          <input className="input w-48" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" autoFocus />
          <input className="input min-w-0 flex-1" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
          <button className="btn-primary">Save</button>
          <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <span className="block truncate font-medium hover:underline">{c.name}</span>
        {c.description && <span className="block truncate text-sm text-slate-500">{c.description}</span>}
      </button>
      <span className="text-sm text-slate-400">{count} highlight{count === 1 ? "" : "s"}</span>
      <button className="btn-ghost" onClick={() => setEditing(true)}>Edit</button>
      <button
        className="btn-ghost text-red-600"
        onClick={() => {
          if (confirm(`Delete the collection “${c.name}”? Its highlights are kept.`)) void deleteCollection(c.id);
        }}
      >
        Delete
      </button>
    </li>
  );
}

function TagRow({ t, count, onOpen }: { t: Tag; count: number; onOpen: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  return (
    <li className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-white">
      {editing ? (
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void renameTag(t.id, name);
            setEditing(false);
          }}
        >
          <input className="input w-48" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Tag name" />
          <button className="btn">Save</button>
        </form>
      ) : (
        <button className="flex-1 text-left text-sm hover:underline" onClick={onOpen}>#{t.name}</button>
      )}
      <span className="text-xs text-slate-400">{count}</span>
      {!editing && <button className="btn-ghost" onClick={() => setEditing(true)}>Rename</button>}
      <button
        className="btn-ghost text-red-600"
        onClick={() => {
          if (confirm(`Delete the tag “${t.name}”? It is removed from ${count} highlight${count === 1 ? "" : "s"}.`)) void deleteTag(t.id);
        }}
      >
        Delete
      </button>
    </li>
  );
}
