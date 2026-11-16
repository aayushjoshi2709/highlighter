import { buildTextIndex, describeRange, resolveToRange } from "../anchoring/anchor";
import type { ContentRequest, ContentState } from "../shared/messages";
import { sendBg } from "../shared/messages";
import { CHANGE_KEY, getPrefs, onPrefsChanged, type ChangeNotice } from "../shared/prefs";
import type { DocumentInput } from "../shared/repo";
import type { Highlight, HighlightColor } from "../shared/types";
import { debounce, normalizeUrl, webDocumentId } from "../shared/util";
import { createRenderer } from "./renderer";
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

  /** Re-resolves every highlight against the current DOM and repaints. */
  function apply() {
    if (!document.body) return;
    applying = true;
    try {
      if (renderer.mutatesDom) renderer.clear(); // resolve against the unwrapped DOM
      const items: { id: string; color: HighlightColor; range: Range }[] = [];
      const orphans = new Set<string>();
      if (highlights.size) {
        const index = buildTextIndex(document.body);
        for (const h of highlights.values()) {
          const { range } = resolveToRange(index, h.anchor);
          if (range) items.push({ id: h.id, color: h.color, range });
          else orphans.add(h.id);
        }
      }
      orphanIds = orphans;
      renderer.render(items);
    } finally {
      observer.takeRecords();
      applying = false;
    }
  }

  async function load() {
    const res = await guard(() => sendBg<{ highlights: Highlight[] }>({ type: "page:load", document: describeDocument() }));
    if (!res) return;
    highlights = new Map(res.highlights.map((h) => [h.id, h]));
    apply();
  }

  // Dynamic pages: content may arrive (or be re-rendered) after load.
  const reapply = debounce(() => {
    if (alive && highlights.size) apply();
  }, 700);
  const observer = new MutationObserver((mutations) => {
    if (applying || !highlights.size) return;
    if (mutations.every((m) => toolbar.contains(m.target))) return;
    reapply();
  });

  // SPA navigation: content scripts cannot see the page's history calls, so watch the URL.
  const onUrlMaybeChanged = () => {
    const next = webDocumentId(location.href);
    if (next === documentId) return;
    documentId = next;
    highlights = new Map();
    orphanIds = new Set();
    toolbar.hide();
    setRepair(null);
    renderer.clear();
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

  function anchorForSelection() {
    const range = selectionRange() ?? pickerRange;
    pickerRange = null;
    if (!range) return null;
    // <mark> wrappers (fallback renderer) are inline and do not alter the indexed text.
    return describeRange(buildTextIndex(document.body), range);
  }

  async function createFromSelection(color: HighlightColor, withNote: boolean) {
    const anchor = anchorForSelection();
    if (!anchor) return;
    const created = await guard(() => sendBg<Highlight>({ type: "highlight:create", document: describeDocument(), anchor, color }));
    if (!created) return;
    highlights.set(created.id, created);
    window.getSelection()?.removeAllRanges();
    apply();
    const range = renderer.rangeFor(created.id);
    if (withNote && range) toolbar.showForHighlight(range.getBoundingClientRect(), created, true);
    else toolbar.hide();
  }

  async function patch(id: string, p: Partial<Pick<Highlight, "color" | "note" | "favorite" | "anchor">>, keepOpen = true) {
    const h = highlights.get(id);
    if (!h) return;
    const next = { ...h, ...p };
    highlights.set(id, next);
    apply();
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
      toolbar.hide();
      apply();
      void guard(() => sendBg({ type: "highlight:delete", id }));
    },
    onAttach: () => {
      const anchor = anchorForSelection();
      if (!anchor || !repairId) return;
      const id = repairId;
      setRepair(null);
      window.getSelection()?.removeAllRanges();
      void patch(id, { anchor }, false);
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

  const start = () => {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    void load();
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
}

main();
