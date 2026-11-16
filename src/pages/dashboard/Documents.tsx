import { useMemo } from "react";
import { openDocument } from "../../shared/open";
import { deleteDocument } from "../../shared/repo";
import { domainOf, formatDate } from "../../shared/util";
import type { Data } from "./App";
import { useDashboard } from "./store";

export function Documents({ data }: { data: Data }) {
  const go = useDashboard((s) => s.go);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of data.highlights) m.set(h.source.documentId, (m.get(h.source.documentId) ?? 0) + 1);
    return m;
  }, [data.highlights]);
  const docs = useMemo(() => [...data.documents].sort((a, b) => b.updatedAt - a.updatedAt), [data.documents]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <h1 className="mb-4 text-xl font-semibold">Documents</h1>
      {docs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          Pages and PDFs appear here once you highlight something in them.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Document</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 text-right font-medium">Highlights</th>
                <th className="px-4 py-2 font-medium">Last opened</th>
                <th className="px-4 py-2 font-medium">Last modified</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-b border-slate-100 last:border-0">
                  <td className="max-w-sm px-4 py-2">
                    <div className="flex items-center gap-2">
                      {d.favicon && <img src={d.favicon} alt="" className="h-4 w-4 shrink-0" onError={(e) => (e.currentTarget.style.display = "none")} />}
                      <div className="min-w-0">
                        <div className="truncate font-medium" title={d.title}>{d.title}</div>
                        <div className="truncate text-xs text-slate-500" title={d.url}>
                          {d.url ? (d.type === "webpage" ? d.url : domainOf(d.url) || d.url) : d.localFile ? "Imported file (on this device)" : "Imported file (not on this device)"}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2">{d.type === "pdf" ? "PDF" : "Webpage"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{counts.get(d.id) ?? 0}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-500">{formatDate(d.lastOpenedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-500">{formatDate(d.updatedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <button className="btn-ghost" onClick={() => go("all", { documentId: d.id })}>Highlights</button>
                    <button className="btn-ghost" onClick={() => openDocument(d)}>Open</button>
                    <button
                      className="btn-ghost text-red-600"
                      onClick={() => {
                        const n = counts.get(d.id) ?? 0;
                        if (confirm(`Delete “${d.title}” and its ${n} highlight${n === 1 ? "" : "s"}?`)) void deleteDocument(d.id);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4">
        <a className="btn" href="../pdf/index.html" target="_blank" rel="noreferrer">Import a PDF…</a>
      </div>
    </div>
  );
}
