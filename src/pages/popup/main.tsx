import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { colorWithAlpha } from "../../shared/colors";
import { db } from "../../shared/db";
import { sendBg, type ContentRequest, type ContentState } from "../../shared/messages";
import { openHighlightSource } from "../../shared/open";
import { setPrefs } from "../../shared/prefs";
import { highlightsForDocument } from "../../shared/repo";
import type { Highlight } from "../../shared/types";
import { isPdfUrl, viewerUrl, webDocumentId } from "../../shared/util";
import { ForkLink, Swatches, SyncDot, useAccount, usePrefs } from "../../ui/common";
import "../../ui/styles.css";
import "../../ui/theme";

function useActiveTab() {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => setTab(t ?? null));
  }, []);
  return tab;
}

/** The document shown in a tab: a web page, or a PDF open in the extension viewer. */
function documentIdForTab(url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith(chrome.runtime.getURL("pdf/"))) return new URL(url).searchParams.get("doc");
  return /^(https?|file):/.test(url) ? webDocumentId(url) : null;
}

function Popup() {
  const tab = useActiveTab();
  const account = useAccount();
  const prefs = usePrefs();
  const [orphans, setOrphans] = useState<string[]>([]);
  const [hasContent, setHasContent] = useState(false);
  const [error, setError] = useState("");
  const docId = documentIdForTab(tab?.url);

  const pageHighlights = useLiveQuery(() => (docId ? highlightsForDocument(docId) : Promise.resolve([])), [docId]) ?? [];
  const recent = useLiveQuery(async () => (await db.highlights.orderBy("createdAt").reverse().limit(30).toArray()).filter((h) => !h.deletedAt).slice(0, 5), []) ?? [];

  const toTab = async <T,>(msg: ContentRequest): Promise<T | undefined> => {
    if (tab?.id === undefined) return undefined;
    try {
      return (await chrome.tabs.sendMessage(tab.id, msg)) as T;
    } catch {
      return undefined;
    }
  };

  useEffect(() => {
    if (!tab) return;
    void toTab<ContentState>({ type: "content:state" }).then((state) => {
      setHasContent(Boolean(state));
      setOrphans(state?.orphanIds ?? []);
    });
  }, [tab, pageHighlights.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const openDashboard = (hash = "") => void chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard/index.html${hash}`) });
  const nativePdf = tab?.url && isPdfUrl(tab.url);

  const Row = ({ h, onClick }: { h: Highlight; onClick: () => void }) => (
    <li>
      <button className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100" onClick={onClick}>
        <span className="line-clamp-2 rounded px-1 text-[13px]" style={{ background: colorWithAlpha(h.color, 0.45) }}>{h.anchor.exact}</span>
        {orphans.includes(h.id) && <span className="mt-0.5 block text-[11px] text-amber-700">Text not found on this page</span>}
      </button>
      {orphans.includes(h.id) && (
        <button
          className="ml-2 text-[11px] text-blue-700 underline"
          onClick={() => void toTab({ type: "content:repair", id: h.id }).then(() => window.close())}
        >
          Repair: reselect the text
        </button>
      )}
    </li>
  );

  return (
    <div className="w-[340px] bg-white text-slate-800">
      <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <img src="../icons/icon32.png" alt="" className="h-5 w-5" />
        <span className="flex-1 text-sm font-semibold">Highlighter</span>
        <button className="btn-ghost" onClick={() => openDashboard("#settings")} title="Settings">⚙</button>
      </header>

      <section className="border-b border-slate-200 px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
          <span>Default color</span>
          <Swatches value={prefs.defaultColor} onPick={(defaultColor) => void setPrefs({ defaultColor })} size={18} />
        </div>
        {hasContent && (
          <button className="btn w-full justify-center" onClick={() => void toTab({ type: "content:highlightSelection", color: prefs.defaultColor }).then(() => window.close())}>
            Highlight current selection
          </button>
        )}
        {nativePdf && (
          <button className="btn-primary w-full justify-center" onClick={() => tab?.id !== undefined && void chrome.tabs.update(tab.id, { url: viewerUrl({ src: tab.url }) })}>
            Open this PDF in Highlighter
          </button>
        )}
      </section>

      <section className="px-1 py-2">
        <h2 className="px-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          This page · {pageHighlights.length} highlight{pageHighlights.length === 1 ? "" : "s"}
        </h2>
        {pageHighlights.length === 0 ? (
          <p className="px-2 py-2 text-xs text-slate-500">{docId ? "Select text on the page and pick a color." : "This page can't be highlighted."}</p>
        ) : (
          <ul className="max-h-40 overflow-auto">
            {pageHighlights.map((h) => (
              <Row key={h.id} h={h} onClick={() => void toTab({ type: "content:scrollTo", id: h.id })} />
            ))}
          </ul>
        )}
      </section>

      <section className="border-t border-slate-200 px-1 py-2">
        <h2 className="px-2 text-xs font-medium uppercase tracking-wide text-slate-500">Recent</h2>
        {recent.length === 0 && <p className="px-2 py-2 text-xs text-slate-500">Nothing yet.</p>}
        <ul>
          {recent.map((h) => (
            <li key={h.id}>
              <button className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100" onClick={() => openHighlightSource(h)}>
                <span className="line-clamp-1 text-[13px]">{h.anchor.exact}</span>
                <span className="block truncate text-[11px] text-slate-500">{h.source.title}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <footer className="flex flex-col gap-2 border-t border-slate-200 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <SyncDot />
          {account ? (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500" title={account.email}>
              {account.picture && <img src={account.picture} alt="" className="h-4 w-4 rounded-full" referrerPolicy="no-referrer" />}
              <span className="truncate">{account.email}</span>
            </span>
          ) : (
            <button
              className="shrink-0 text-xs text-blue-700 underline"
              onClick={() => void sendBg({ type: "auth:signIn" }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))}
            >
              Sign in with Google
            </button>
          )}
        </div>
        {error && <p className="text-xs text-red-700">{error}</p>}
        <button className="btn-primary w-full justify-center" onClick={() => openDashboard()}>Open dashboard</button>
        <ForkLink className="justify-center" />
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
