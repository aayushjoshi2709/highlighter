import { buildTextIndex, buildTextIndexAsync, describeRange, resolveToRange } from "../anchoring/anchor";
import type { ContentRequest, ContentState } from "../shared/messages";
import { sendBg } from "../shared/messages";
import { CHANGE_KEY, getPrefs, onPrefsChanged, type ChangeNotice } from "../shared/prefs";
import type { DocumentInput } from "../shared/repo";
import type { Highlight, HighlightColor } from "../shared/types";
import { normalizeUrl, webDocumentId } from "../shared/util";
import { createRenderer } from "./renderer";
import { debounceMax, whenIdle, yieldToMain } from "./scheduler";
import { Toolbar } from "./toolbar";

declare global {
  interface Window {
    __wphLoaded?: boolean;
  }
}

function main() {
  // Only the top frame of real HTML documents; PDFs are handled by the extension viewer.
  if (window.__wphLoaded || window.top !== window) return;
  if (document.contentType && !/html|xml/.test(document.contentType)) return;
  window.__wphLoaded = true;

  const renderer = createRenderer();
  let documentId = webDocumentId(location.href);
  let highlights = new Map<string, Highlight>();
  let orphanIds = new Set<string>();
  let repairId: string | null = null;
  let applying = false;
  let alive = true;

  const describeDocument = (): DocumentInput => {
    const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href;
    return {
      id: documentId,
      type: "webpage",
      title: document.title || location.hostname,
      url: normalizeUrl(location.href),
      favicon: icon || `${location.origin}/favicon.ico`,
    };
  };

  /** The extension was reloaded/removed: this script can no longer talk to it. */
  const guard = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (!alive) return undefined;
    try {
      return await fn();
    } catch (e) {
      if (!chrome.runtime?.id) {
        alive = false;
        observer.disconnect();
        clearInterval(urlTimer);
      } else console.warn("[Highlighter]", e);
      return undefined;
    }
  };

  // ------------------------------------------------------------- rendering

  /** Where each highlight currently sits in the DOM (live ranges from the last restoration). */
  let resolved = new Map<string, Range>();
  /** Bumped on every page mutation; lets a restoration notice that its index went stale. */
  let domVersion = 0;
  /** Identifies the newest restoration; older ones stop at their next yield. */
  let runId = 0;
  let staleRuns = 0;
  const SLICE_MS = 5;

  /** Paints from the ranges already known. Cheap and synchronous: no indexing. */
  function repaint() {
    // The <mark> fallback cannot repaint in place: its wrappers have to be rebuilt.
    if (renderer.mutatesDom) return restoreSync();
    paint();
    syncObserver();
  }

  function paint() {
    for (const id of resolved.keys()) if (!highlights.has(id)) resolved.delete(id);
    const items: { id: string; color: HighlightColor; range: Range }[] = [];
    for (const h of highlights.values()) {
      const range = resolved.get(h.id);
      if (range) items.push({ id: h.id, color: h.color, range });
    }
    renderer.render(items);
  }

  const strip = (s: string) => s.replace(/\s+/g, "");

  /**
   * Re-resolves every highlight against the current DOM and repaints.
   *
   * Never blocks the page: it waits for an idle period, indexes the document
   * in ~5 ms slices and resolves anchors in slices too, yielding to rendering
   * and input in between. If the DOM changes underneath it, the stale result
   * is dropped and the (debounced) mutation handler starts a fresh run.
   */
  async function restore() {
    const id = ++runId;
    syncObserver();
    if (!document.body) return;
    if (renderer.mutatesDom) return restoreSync();
    if (!highlights.size) {
      orphanIds = new Set();
      resolved = new Map();
      repaint();
      return;
    }

    await whenIdle();
    if (id !== runId || !alive) return;
    const version = domVersion;
    const index = await buildTextIndexAsync(document.body, { sliceMs: SLICE_MS, yieldToMain, isCancelled: () => id !== runId || !alive });
    if (!index) return;

    // A page that mutates constantly would make every run stale; after a few
    // attempts accept the index but verify each range against its quote.
    let verify = false;
    if (version !== domVersion) {
      if (++staleRuns < 3) return void scheduleRestore();
      verify = true;
    }
    staleRuns = 0;

    const next = new Map<string, Range>();
    const orphans = new Set<string>();
    let deadline = performance.now() + SLICE_MS;
    for (const h of [...highlights.values()]) {
      let range: Range | null = null;
      try {
        const r = resolveToRange(index, h.anchor);
        range = r.range;
        if (range && verify && r.status === "exact" && strip(range.toString()) !== strip(h.anchor.exact)) range = null;
      } catch {
        range = null; // a node changed since it was indexed
      }
      if (range) next.set(h.id, range);
      else orphans.add(h.id);
      if (performance.now() >= deadline) {
        await yieldToMain();
        if (id !== runId || !alive) return;
        deadline = performance.now() + SLICE_MS;
      }
    }
    // Highlights created while this run was in flight were painted from their selection; keep them.
    for (const [hid, range] of resolved) if (!next.has(hid) && !orphans.has(hid)) next.set(hid, range);
    resolved = next;
    orphanIds = new Set([...orphans].filter((o) => highlights.has(o)));
    repaint();
  }

  /** <mark> fallback only: wrappers must be removed, indexed and re-added in one task to avoid flicker. */
  function restoreSync() {
    applying = true;
    try {
      renderer.clear();
      const index = buildTextIndex(document.body);
      const next = new Map<string, Range>();
      const orphans = new Set<string>();
      for (const h of highlights.values()) {
        const { range } = resolveToRange(index, h.anchor);
        if (range) next.set(h.id, range);
        else orphans.add(h.id);
      }
      resolved = next;
      orphanIds = orphans;
      paint();
    } finally {
      observer.takeRecords(); // our own wrapper changes are not page mutations
      applying = false;
    }
    syncObserver();
  }

  async function load() {
    const res = await guard(() => sendBg<{ highlights: Highlight[] }>({ type: "page:load", document: describeDocument() }));
    if (!res) return;
    const incoming = new Map(res.highlights.map((h) => [h.id, h]));
    // Colour, note or favourite edits and deletions do not move anything: repaint without re-indexing.
    const sameAnchors = [...incoming.values()].every((h) => {
      const old = highlights.get(h.id);
      return old && old.anchor.exact === h.anchor.exact && old.anchor.start === h.anchor.start && old.anchor.prefix === h.anchor.prefix;
    });
    highlights = incoming;
    if (sameAnchors && !renderer.mutatesDom) {
      orphanIds = new Set([...orphanIds].filter((o) => highlights.has(o)));
      repaint();
    } else void restore();
  }

  // Dynamic pages: content may arrive (or be re-rendered) after load.
  const scheduleRestore = debounceMax(() => {
    if (alive && highlights.size) void restore();
  }, 700, 3000);
  const observer = new MutationObserver((mutations) => {
    if (applying) return;
    if (mutations.every((m) => toolbar.contains(m.target))) return;
    domVersion++;
    scheduleRestore();
  });
  // Pages without highlights are not observed at all.
  let observing = false;
  function syncObserver() {
    const want = alive && highlights.size > 0 && Boolean(document.body);
    if (want === observing) return;
    observing = want;
    if (want) observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    else observer.disconnect();
  }

  // SPA navigation: content scripts cannot see the page's history calls, so watch the URL.
  const onUrlMaybeChanged = () => {
    const next = webDocumentId(location.href);
    if (next === documentId) return;
    documentId = next;
    highlights = new Map();
    orphanIds = new Set();
    resolved = new Map();
    runId++; // abandon any restoration for the previous page
    toolbar.hide();
    setRepair(null);
    repaint();
    void load();
  };
  const urlTimer = setInterval(onUrlMaybeChanged, 800);
  window.addEventListener("popstate", onUrlMaybeChanged);
  window.addEventListener("hashchange", onUrlMaybeChanged);

  // -------------------------------------------------------------- actions

  function selectionRange(): Range | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!range.toString().trim()) return null;
    const el = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (!el || toolbar.contains(el)) return null;
    if (el.closest("input, textarea, [contenteditable=''], [contenteditable='true']")) return null;
    return range;
  }

  /** Selection captured when the colour picker opened, in case the picker clears it. */
  let pickerRange: Range | null = null;

  /**
   * Describes the current selection as an anchor. The selection is captured
   * first (as a live range); the document is then indexed in slices, retrying
   * if the page changed meanwhile, so even this user-initiated step cannot freeze the page.
   */
  async function anchorForSelection() {
    const range = (selectionRange() ?? pickerRange)?.cloneRange();
    pickerRange = null;
    if (!range) return null;
    // <mark> wrappers (fallback renderer) are inline and do not alter the indexed text.
    for (let attempt = 0; attempt < 3; attempt++) {
      const version = domVersion;
      const index = await buildTextIndexAsync(document.body, { sliceMs: 8, yieldToMain });
      if (index && version === domVersion) return { anchor: describeRange(index, range), range };
    }
    return { anchor: describeRange(buildTextIndex(document.body), range), range };
  }

  async function createFromSelection(color: HighlightColor, withNote: boolean) {
    const described = await anchorForSelection();
    const anchor = described?.anchor;
    if (!described || !anchor) return;
    const created = await guard(() => sendBg<Highlight>({ type: "highlight:create", document: describeDocument(), anchor, color }));
    if (!created) return;
    highlights.set(created.id, created);
    window.getSelection()?.removeAllRanges();
    // The selected range is exactly where the highlight goes: paint it now, no re-indexing.
    resolved.set(created.id, described.range);
    repaint();
    const range = renderer.rangeFor(created.id);
    if (withNote && range) toolbar.showForHighlight(range.getBoundingClientRect(), created, true);
    else toolbar.hide();
  }

  async function patch(id: string, p: Partial<Pick<Highlight, "color" | "note" | "favorite" | "anchor">>, keepOpen = true) {
    const h = highlights.get(id);
    if (!h) return;
    const next = { ...h, ...p };
    highlights.set(id, next);
    repaint();
    await guard(() => sendBg({ type: "highlight:update", id, patch: p }));
    const range = renderer.rangeFor(id);
    if (keepOpen && range && toolbar.editingId === id) toolbar.showForHighlight(range.getBoundingClientRect(), next);
    else toolbar.hide();
  }

  function setRepair(id: string | null) {
    repairId = id;
    const h = id ? highlights.get(id) : null;
    toolbar.setRepairBanner(h ? `Select the text for “${h.anchor.exact.slice(0, 60)}${h.anchor.exact.length > 60 ? "…" : ""}”` : null);
  }

  const toolbar = new Toolbar({
    onCreate: (color, withNote) => void createFromSelection(color, withNote),
    onRecolor: (id, color) => void patch(id, { color }),
    onNote: (id, note) => void patch(id, { note: note.trim() || undefined }, false),
    onFavorite: (id, favorite) => void patch(id, { favorite }),
    onDelete: (id) => {
      highlights.delete(id);
      orphanIds.delete(id);
      toolbar.hide();
      repaint();
      void guard(() => sendBg({ type: "highlight:delete", id }));
    },
    onAttach: () => {
      const id = repairId;
      if (!id) return;
      void anchorForSelection().then((described) => {
        if (!described?.anchor) return;
        setRepair(null);
        window.getSelection()?.removeAllRanges();
        resolved.set(id, described.range);
        orphanIds.delete(id);
        void patch(id, { anchor: described.anchor }, false);
      });
    },
    onCancelRepair: () => setRepair(null),
    onPickerOpen: () => {
      pickerRange = selectionRange()?.cloneRange() ?? null;
    },
  });

  // --------------------------------------------------------------- events

  document.addEventListener("mouseup", (e) => {
    if (!alive || toolbar.contains(e.target)) return;
    // Let the browser finalise the selection first.
    setTimeout(() => {
      const range = selectionRange();
      if (range) {
        const rects = range.getClientRects();
        toolbar.showForSelection(rects.length ? rects[0] : range.getBoundingClientRect(), Boolean(repairId));
        return;
      }
      const id = renderer.hitTest(e.clientX, e.clientY);
      const h = id ? highlights.get(id) : undefined;
      const r = id ? renderer.rangeFor(id) : null;
      if (h && r && e.button === 0) {
        const rects = r.getClientRects();
        toolbar.showForHighlight(rects.length ? rects[0] : r.getBoundingClientRect(), h);
      }
    }, 10);
  });

  document.addEventListener("mousedown", (e) => {
    if (!toolbar.isOpen || toolbar.contains(e.target)) return;
    if (toolbar.isPickingColor) {
      // This click only dismisses the browser's colour picker; keep the bar for its result.
      toolbar.isPickingColor = false;
      return;
    }
    toolbar.hide();
  }, true);

  document.addEventListener("selectionchange", () => {
    if (!toolbar.isOpen || toolbar.editingId || toolbar.isPickingColor) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) toolbar.hide();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (toolbar.isOpen) toolbar.hide();
    if (repairId) setRepair(null);
  });

  // Changes made elsewhere (dashboard, popup, sync) arrive through storage.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!alive || area !== "local" || !changes[CHANGE_KEY]) return;
    const notice = changes[CHANGE_KEY].newValue as ChangeNotice | undefined;
    if (notice?.documentIds.includes(documentId) && !toolbar.isEditingNote) void load();
  });

  chrome.runtime.onMessage.addListener((msg: ContentRequest, _sender, sendResponse) => {
    switch (msg.type) {
      case "content:state": {
        const state: ContentState = { documentId, highlights: [...highlights.values()], orphanIds: [...orphanIds] };
        sendResponse(state);
        break;
      }
      case "content:highlightSelection":
        void createFromSelection(msg.color ?? toolbar.defaultColor, false);
        sendResponse(true);
        break;
      case "content:scrollTo": {
        const range = renderer.rangeFor(msg.id);
        const el = range?.startContainer.parentElement;
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        renderer.flash(msg.id);
        sendResponse(Boolean(range));
        break;
      }
      case "content:repair":
        setRepair(msg.id);
        sendResponse(true);
        break;
    }
    return false;
  });

  void getPrefs().then((p) => (toolbar.defaultColor = p.defaultColor)).catch(() => {});
  onPrefsChanged((p) => (toolbar.defaultColor = p.defaultColor));

  // Nothing here is urgent: let the page finish its own startup work first.
  const start = () => void whenIdle().then(load);
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}

main();
