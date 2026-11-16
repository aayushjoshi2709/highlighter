import { useLiveQuery } from "dexie-react-hooks";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { buildTextIndex, describeRange, resolveToRange } from "../../anchoring/anchor";
import { restorePdfBackup } from "../../background/sync";
import { colorWithAlpha } from "../../shared/colors";
import { db } from "../../shared/db";
import { sendBg } from "../../shared/messages";
import {
  createHighlight, deleteHighlights, highlightsForDocument, updateHighlight, upsertDocument, type DocumentInput,
} from "../../shared/repo";
import type { Highlight, HighlightColor, NormRect } from "../../shared/types";
import { pdfDocumentId } from "../../shared/util";
import { Swatches, usePrefs } from "../../ui/common";
import { hitRects, rangeRects } from "./geometry";
import { openPdf, pdfjs, type PDFDocumentProxy } from "./pdfjs";

interface Loaded {
  pdf: PDFDocumentProxy;
  doc: DocumentInput;
  src?: string;
  baseSize: { w: number; h: number };
}

type Phase =
  | { kind: "empty" }
  | { kind: "loading"; label: string }
  | { kind: "ready"; loaded: Loaded }
  | { kind: "missing"; documentId: string; title: string }
  | { kind: "error"; message: string; src?: string };

type Source = { src: string } | { doc: string } | { file: File };

function fileNameFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() || url);
  } catch {
    return url;
  }
}

export function Viewer() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [phase, setPhase] = useState<Phase>({ kind: "empty" });

  const load = useCallback(async (source: Source) => {
    setPhase({ kind: "loading", label: "file" in source ? source.file.name : "PDF" });
    let src: string | undefined;
    try {
      let pdf: PDFDocumentProxy;
      let name = "";
      let imported: File | undefined;
      if ("file" in source) {
        imported = source.file;
        name = imported.name;
        pdf = await openPdf({ data: await imported.arrayBuffer() });
      } else if ("doc" in source) {
        const [stored, meta] = await Promise.all([db.pdfFiles.get(source.doc), db.documents.get(source.doc)]);
        if (stored) {
          name = stored.name;
          pdf = await openPdf({ data: await stored.blob.arrayBuffer() });
        } else if (meta?.url) {
          src = meta.url;
          pdf = await openPdf({ url: src });
        } else {
          setPhase({ kind: "missing", documentId: source.doc, title: meta?.title ?? "This PDF" });
          return;
        }
      } else {
        src = source.src;
        pdf = await openPdf({ url: src });
      }

      const fingerprint = pdf.fingerprints[0] ?? `${pdf.numPages}-${name || src}`;
      const id = pdfDocumentId(fingerprint);
      const meta = (await pdf.getMetadata().catch(() => null))?.info as { Title?: string } | undefined;
      const title = meta?.Title?.trim() || name || (src ? fileNameFromUrl(src) : "Untitled PDF");
      const doc: DocumentInput = { id, type: "pdf", title, url: src, fingerprint, pageCount: pdf.numPages };

      if (imported) {
        // The user chose to import this file: keep the bytes locally (never uploaded unless backup is on).
        await db.pdfFiles.put({ documentId: id, name, blob: imported, size: imported.size, addedAt: Date.now() });
        doc.localFile = true;
        await upsertDocument(doc, { opened: true });
        history.replaceState(null, "", `?doc=${encodeURIComponent(id)}`);
      } else {
        const existing = await db.documents.get(id);
        if (existing && !existing.deletedAt) await upsertDocument({ ...doc, title: existing.title }, { opened: true });
        if (existing?.localFile) doc.localFile = true;
      }

      const first = await pdf.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      document.title = `${title} · Highlighter`;
      setPhase({ kind: "ready", loaded: { pdf, doc, src, baseSize: { w: vp.width, h: vp.height } } });
    } catch (e) {
      console.error(e);
      const message = e instanceof Error ? e.message : String(e);
      setPhase({ kind: "error", message, src });
    }
  }, []);

  useEffect(() => {
    const src = params.get("src");
    const doc = params.get("doc");
    if (doc) void load({ doc });
    else if (src) void load({ src });
  }, [params, load]);

  const pickFile = (expectPdf: FileList | null) => {
    const file = expectPdf?.[0];
    if (file) void load({ file });
  };

  if (phase.kind === "ready") {
    return (
      <DocumentView
        key={phase.loaded.doc.id}
        loaded={phase.loaded}
        initialPage={Number(params.get("page")) || 1}
        initialHighlight={params.get("highlight")}
        onImport={pickFile}
      />
    );
  }

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4 bg-slate-100 p-8 text-slate-700"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        pickFile(e.dataTransfer.files);
      }}
    >
      {phase.kind === "loading" && <p className="text-sm">Opening {phase.label}…</p>}
      {phase.kind === "empty" && (
        <>
          <h1 className="text-xl font-semibold">Open a PDF</h1>
          <p className="text-sm text-slate-500">Drop a PDF here, or choose one from your computer. It stays on this device.</p>
        </>
      )}
      {phase.kind === "missing" && (
        <>
          <h1 className="text-xl font-semibold">{phase.title} is not on this device</h1>
          <p className="max-w-md text-center text-sm text-slate-500">
            Its highlights are synced, but the PDF file itself is only stored where it was imported. Import the same file here,
            or restore it from Drive if you turned on PDF backup.
          </p>
          <button
            className="btn"
            onClick={() => {
              const { documentId, title } = phase;
              setPhase({ kind: "loading", label: "backup" });
              restorePdfBackup(documentId, title).then(
                (ok) => (ok ? load({ doc: documentId }) : setPhase({ kind: "error", message: "No Drive backup was found for this PDF." })),
                (e) => setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) }),
              );
            }}
          >
            Restore from Drive backup
          </button>
        </>
      )}
      {phase.kind === "error" && (
        <>
          <h1 className="text-xl font-semibold">Could not open this PDF</h1>
          <p className="max-w-lg text-center text-sm text-red-700">{phase.message}</p>
          {phase.src?.startsWith("file:") && (
            <p className="max-w-lg text-center text-sm text-slate-500">
              For local files, enable “Allow access to file URLs” for this extension in chrome://extensions, or import the file below.
            </p>
          )}
          {phase.src && (
            <button className="btn" onClick={() => void sendBg({ type: "pdf:openNative", url: phase.src! })}>
              Open in Chrome’s PDF viewer instead
            </button>
          )}
        </>
      )}
      {phase.kind !== "loading" && (
        <label className="btn-primary cursor-pointer">
          Import PDF
          <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => pickFile(e.target.files)} />
        </label>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ document

type Popover =
  | { kind: "new"; x: number; y: number }
  | { kind: "edit"; x: number; y: number; id: string; note: boolean };

const EMPTY: Highlight[] = [];
const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3];

function DocumentView(props: { loaded: Loaded; initialPage: number; initialHighlight: string | null; onImport: (f: FileList | null) => void }) {
  const { pdf, doc, src, baseSize } = props.loaded;
  const prefs = usePrefs();
  const scroller = useRef<HTMLDivElement>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const derivedRects = useRef(new Map<string, NormRect[]>());
  const pendingRange = useRef<Range | null>(null);
  const [scale, setScale] = useState(1.25);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [popover, setPopover] = useState<Popover | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [flashId, setFlashId] = useState<string | null>(null);

  const highlights = useLiveQuery(() => highlightsForDocument(doc.id), [doc.id]) ?? EMPTY;
  const byPage = useMemo(() => {
    const map = new Map<number, Highlight[]>();
    for (const h of highlights) {
      const n = h.anchor.pageNumber ?? 1;
      map.set(n, [...(map.get(n) ?? []), h]);
    }
    return map;
  }, [highlights]);
  const ordered = useMemo(
    () => [...highlights].sort((a, b) => (a.anchor.pageNumber ?? 0) - (b.anchor.pageNumber ?? 0) || (a.anchor.rects?.[0]?.y ?? 0) - (b.anchor.rects?.[0]?.y ?? 0)),
    [highlights],
  );

  const goToPage = useCallback((n: number, smooth = false) => {
    const clamped = Math.max(1, Math.min(pdf.numPages, Math.round(n) || 1));
    pageEls.current.get(clamped)?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
    setPage(clamped);
    setPageInput(String(clamped));
  }, [pdf]);

  const flash = useCallback((id: string) => {
    setFlashId(id);
    setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1600);
  }, []);

  // Fit to width on first layout, then jump to the requested page.
  useLayoutEffect(() => {
    const width = scroller.current?.clientWidth ?? 0;
    if (width) setScale(Math.max(0.5, Math.min(1.5, (width - 48) / baseSize.w)));
  }, [baseSize.w]);
  const didInit = useRef(false);
  const anchorPage = useRef(props.initialPage);
  useLayoutEffect(() => {
    // Keep the same page in view when the zoom changes.
    goToPage(didInit.current ? anchorPage.current : props.initialPage);
    if (!didInit.current && props.initialHighlight) flash(props.initialHighlight);
    didInit.current = true;
  }, [scale]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    anchorPage.current = page;
  }, [page]);

  const onScroll = useMemo(() => {
    let frame = 0;
    return () => {
      setPopover(null);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const el = scroller.current;
        if (!el) return;
        const mark = el.scrollTop + el.clientHeight / 3;
        let current = 1;
        for (const [n, p] of pageEls.current) if (p.offsetTop <= mark && n > current) current = n;
        setPage(current);
        setPageInput(String(current));
      });
    };
  }, []);

  const pageOf = (node: Node): number | null => {
    const el = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-page]");
    return el ? Number(el.dataset.page) : null;
  };

  const rectsOf = (h: Highlight) => (h.anchor.rects?.length ? h.anchor.rects : derivedRects.current.get(h.id));

  const onMouseUp = (e: React.MouseEvent) => {
    if ((e.target as Element).closest("[data-popover]")) return;
    const { clientX, clientY, target } = e;
    setTimeout(() => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount && sel.toString().trim()) {
        const range = sel.getRangeAt(0);
        if (pageOf(range.startContainer) && pageOf(range.endContainer)) {
          pendingRange.current = range.cloneRange();
          const r = range.getClientRects()[0] ?? range.getBoundingClientRect();
          setPopover({ kind: "new", x: r.left + r.width / 2, y: r.top });
          return;
        }
      }
      const pageEl = (target as Element).closest<HTMLElement>("[data-page]");
      if (!pageEl) return setPopover(null);
      const box = pageEl.getBoundingClientRect();
      const x = (clientX - box.left) / box.width;
      const y = (clientY - box.top) / box.height;
      const hit = [...(byPage.get(Number(pageEl.dataset.page)) ?? [])].reverse().find((h) => hitRects(rectsOf(h), x, y));
      setPopover(hit ? { kind: "edit", x: clientX, y: clientY - 8, id: hit.id, note: false } : null);
    }, 0);
  };

  /** A selection may span pages; each page gets its own highlight so every anchor is page-local. */
  const createFromSelection = async (color: HighlightColor, withNote: boolean) => {
    const range = pendingRange.current;
    if (!range) return;
    const first = pageOf(range.startContainer);
    const last = pageOf(range.endContainer);
    if (!first || !last) return;
    let created: Highlight | undefined;
    for (let n = first; n <= last; n++) {
      const pageEl = pageEls.current.get(n);
      const layer = pageEl?.querySelector(".textLayer");
      if (!pageEl || !layer) continue;
      const sub = range.cloneRange();
      if (n > first) sub.setStart(layer, 0);
      if (n < last) sub.setEnd(layer, layer.childNodes.length);
      const anchor = describeRange(buildTextIndex(layer), sub);
      if (!anchor) continue;
      created = await createHighlight({ document: doc, anchor: { ...anchor, pageNumber: n, rects: rangeRects(sub, pageEl) }, color });
    }
    pendingRange.current = null;
    window.getSelection()?.removeAllRanges();
    setPopover((p) => (created && withNote && p ? { kind: "edit", x: p.x, y: p.y, id: created.id, note: true } : null));
  };

  const editing = popover?.kind === "edit" ? highlights.find((h) => h.id === popover.id) : undefined;
  const zoom = (dir: 1 | -1) => {
    const i = ZOOM_STEPS.findIndex((z) => (dir > 0 ? z > scale + 0.01 : z >= scale - 0.01));
    const next = dir > 0 ? ZOOM_STEPS[i === -1 ? ZOOM_STEPS.length - 1 : i] : ZOOM_STEPS[Math.max(0, (i === -1 ? ZOOM_STEPS.length : i) - 1)];
    setScale(next);
  };
  const fitWidth = () => {
    const available = (scroller.current?.clientWidth ?? 800) - 48;
    setScale(Math.max(0.3, Math.min(3, available / baseSize.w)));
  };

  const pages = useMemo(() => Array.from({ length: pdf.numPages }, (_, i) => i + 1), [pdf]);

  return (
    <div className="flex h-full flex-col bg-slate-200 text-slate-800">
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-300 bg-white px-3 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate font-medium" title={doc.title}>{doc.title}</span>
        <button className="btn-ghost" onClick={() => goToPage(page - 1)} disabled={page <= 1} title="Previous page">‹</button>
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            goToPage(Number(pageInput));
          }}
        >
          <input className="input w-14 text-center" value={pageInput} onChange={(e) => setPageInput(e.target.value)} aria-label="Page number" />
          <span className="text-slate-500">/ {pdf.numPages}</span>
        </form>
        <button className="btn-ghost" onClick={() => goToPage(page + 1)} disabled={page >= pdf.numPages} title="Next page">›</button>
        <span className="mx-1 h-5 w-px bg-slate-300" />
        <button className="btn-ghost" onClick={() => zoom(-1)} title="Zoom out">−</button>
        <span className="w-12 text-center tabular-nums">{Math.round(scale * 100)}%</span>
        <button className="btn-ghost" onClick={() => zoom(1)} title="Zoom in">+</button>
        <button className="btn-ghost" onClick={fitWidth}>Fit width</button>
        <span className="mx-1 h-5 w-px bg-slate-300" />
        <label className="btn-ghost cursor-pointer">
          Import PDF
          <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => props.onImport(e.target.files)} />
        </label>
        {src && <button className="btn-ghost" onClick={() => void sendBg({ type: "pdf:openNative", url: src })}>Chrome viewer</button>}
        <button className="btn-ghost" onClick={() => void sendBg({ type: "dashboard:open" })}>Dashboard</button>
        <button className="btn-ghost" onClick={() => setSidebar((s) => !s)} aria-pressed={sidebar}>
          Highlights ({highlights.length})
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div ref={scroller} className="min-w-0 flex-1 overflow-auto p-4" onScroll={onScroll} onMouseUp={onMouseUp}>
          {pages.map((n) => (
            <PdfPage
              key={n}
              pdf={pdf}
              n={n}
              scale={scale}
              baseSize={baseSize}
              highlights={byPage.get(n) ?? EMPTY}
              flashId={flashId}
              derivedRects={derivedRects}
              register={pageEls}
            />
          ))}
        </div>

        {sidebar && (
          <aside className="w-72 shrink-0 overflow-auto border-l border-slate-300 bg-white">
            {ordered.length === 0 && <p className="p-4 text-sm text-slate-500">Select text in the PDF to highlight it.</p>}
            {ordered.map((h) => (
              <button
                key={h.id}
                className="block w-full border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50"
                onClick={() => {
                  goToPage(h.anchor.pageNumber ?? 1);
                  flash(h.id);
                }}
              >
                <span className="mb-1 block text-xs text-slate-400">Page {h.anchor.pageNumber}</span>
                <span className="line-clamp-4 block rounded px-1 text-sm" style={{ background: colorWithAlpha(h.color, 0.45) }}>{h.anchor.exact}</span>
                {h.note && <span className="mt-1 block text-xs text-slate-600">📝 {h.note}</span>}
              </button>
            ))}
          </aside>
        )}
      </div>

      {popover && (
        <div
          data-popover
          className="fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg bg-white p-2 shadow-xl ring-1 ring-black/10"
          style={{ left: Math.max(170, Math.min(window.innerWidth - 170, popover.x)), top: Math.max(popover.kind === "edit" && popover.note ? 190 : 56, popover.y - 6) }}
          onMouseDown={(e) => {
            if (!(e.target instanceof HTMLTextAreaElement)) e.preventDefault();
          }}
        >
          {popover.kind === "new" && (
            <div className="flex items-center gap-2">
              <Swatches onPick={(c) => void createFromSelection(c, false)} />
              <button className="btn-ghost" onClick={() => void createFromSelection(prefs.defaultColor, true)}>✎ Note</button>
              <button className="btn-ghost" onClick={() => setPopover(null)} title="Dismiss">✕</button>
            </div>
          )}
          {popover.kind === "edit" && editing && (
            <EditPopover
              highlight={editing}
              noteOpen={popover.note}
              onToggleNote={() => setPopover({ ...popover, note: !popover.note })}
              onClose={() => setPopover(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function EditPopover(props: { highlight: Highlight; noteOpen: boolean; onToggleNote: () => void; onClose: () => void }) {
  const h = props.highlight;
  const [note, setNote] = useState(h.note ?? "");
  return (
    <div className="flex w-80 flex-col gap-2">
      <div className="flex items-center gap-1">
        <Swatches value={h.color} onPick={(color) => void updateHighlight(h.id, { color })} />
        <span className="flex-1" />
        <button className="btn-ghost" onClick={props.onToggleNote} title={h.note ? "Edit note" : "Add note"}>✎</button>
        <button className="btn-ghost" onClick={() => void updateHighlight(h.id, { favorite: !h.favorite })} title="Favorite">{h.favorite ? "★" : "☆"}</button>
        <button className="btn-ghost" onClick={() => void navigator.clipboard.writeText(h.anchor.exact)} title="Copy text">⧉</button>
        <button
          className="btn-ghost"
          title="Delete highlight"
          onClick={() => {
            void deleteHighlights([h.id]);
            props.onClose();
          }}
        >
          🗑
        </button>
        <button className="btn-ghost" onClick={props.onClose} title="Dismiss">✕</button>
      </div>
      {h.note && !props.noteOpen && <p className="whitespace-pre-wrap px-1 text-sm text-slate-600">{h.note}</p>}
      {props.noteOpen && (
        <>
          <textarea className="input min-h-20 w-full" autoFocus placeholder="Add a note…" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={props.onToggleNote}>Cancel</button>
            <button
              className="btn-primary"
              onClick={() => {
                void updateHighlight(h.id, { note });
                props.onClose();
              }}
            >
              Save
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------- page

interface PageProps {
  pdf: PDFDocumentProxy;
  n: number;
  scale: number;
  baseSize: { w: number; h: number };
  highlights: Highlight[];
  flashId: string | null;
  derivedRects: MutableRefObject<Map<string, NormRect[]>>;
  register: MutableRefObject<Map<number, HTMLDivElement>>;
}

const MAX_CANVAS_PIXELS = 16_000_000;

/** One PDF page. Renders only while near the viewport so large documents stay cheap. */
const PdfPage = memo(function PdfPage({ pdf, n, scale, baseSize, highlights, flashId, derivedRects, register }: PageProps) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [size, setSize] = useState(baseSize);
  const [textReady, setTextReady] = useState(0);
  const [, bump] = useState(0);

  useEffect(() => {
    const el = root.current!;
    register.current.set(n, el);
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { rootMargin: "1000px 0px" });
    io.observe(el);
    return () => {
      io.disconnect();
      register.current.delete(n);
    };
  }, [n, register]);

  useEffect(() => {
    if (!near) return;
    const c = canvas.current!;
    const layer = text.current!;
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    let textLayer: InstanceType<typeof pdfjs.TextLayer> | undefined;

    (async () => {
      const page = await pdf.getPage(n);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      setSize({ w: viewport.width / scale, h: viewport.height / scale });
      const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
      c.width = Math.floor(viewport.width * ratio);
      c.height = Math.floor(viewport.height * ratio);
      renderTask = page.render({
        canvasContext: c.getContext("2d")!,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
      });
      await renderTask.promise;
      const content = await page.getTextContent();
      if (cancelled) return;
      layer.replaceChildren();
      textLayer = new pdfjs.TextLayer({ textContentSource: content, container: layer, viewport });
      await textLayer.render();
      if (!cancelled) setTextReady((v) => v + 1);
    })().catch((e: unknown) => {
      if ((e as { name?: string })?.name !== "RenderingCancelledException" && !cancelled) console.error(`Page ${n}`, e);
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      c.width = 0;
      c.height = 0;
      layer.replaceChildren();
    };
  }, [near, scale, pdf, n]);

  // Highlights without stored geometry (e.g. imported data) are located through their text anchor.
  useEffect(() => {
    if (!textReady || !near || !text.current || !root.current) return;
    const missing = highlights.filter((h) => !h.anchor.rects?.length && !derivedRects.current.has(h.id));
    if (!missing.length) return;
    const index = buildTextIndex(text.current);
    for (const h of missing) {
      const { range } = resolveToRange(index, h.anchor);
      if (range) derivedRects.current.set(h.id, rangeRects(range, root.current));
    }
    bump((v) => v + 1);
  }, [textReady, near, highlights, derivedRects]);

  return (
    <div
      ref={root}
      data-page={n}
      className="pdf-page"
      style={{ width: size.w * scale, height: size.h * scale, ["--scale-factor" as string]: scale }}
    >
      <canvas ref={canvas} />
      <div className="hl-layer">
        {highlights.flatMap((h) =>
          (h.anchor.rects?.length ? h.anchor.rects : derivedRects.current.get(h.id) ?? []).map((r, i) => (
            <div
              key={`${h.id}-${i}`}
              className={flashId === h.id ? "flash" : undefined}
              style={{
                left: `${r.x * 100}%`,
                top: `${r.y * 100}%`,
                width: `${r.w * 100}%`,
                height: `${r.h * 100}%`,
                background: colorWithAlpha(h.color, 0.6),
              }}
            />
          )),
        )}
      </div>
      <div ref={text} className="textLayer" />
    </div>
  );
});
