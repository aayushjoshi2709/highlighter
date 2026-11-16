import type { ContentRequest } from "./messages";
import type { Document, Highlight } from "./types";
import { viewerUrl } from "./util";

/** Opens a web page and, once its content script is ready, scrolls to the highlight. */
async function openWebAt(url: string, highlightId?: string) {
  const tab = await chrome.tabs.create({ url });
  if (!highlightId || tab.id === undefined) return;
  const tabId = tab.id;
  const msg: ContentRequest = { type: "content:scrollTo", id: highlightId };
  const attempt = async (left: number) => {
    try {
      if (await chrome.tabs.sendMessage(tabId, msg)) return;
    } catch {
      // content script not ready yet
    }
    if (left > 0) setTimeout(() => void attempt(left - 1), 700);
  };
  const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo) => {
    if (id !== tabId || info.status !== "complete") return;
    chrome.tabs.onUpdated.removeListener(onUpdated);
    setTimeout(() => void attempt(6), 400);
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
}

export function openHighlightSource(h: Highlight) {
  if (h.source.type === "pdf") {
    void chrome.tabs.create({ url: viewerUrl({ doc: h.source.documentId, page: h.anchor.pageNumber, highlight: h.id }) });
  } else if (h.source.url) {
    void openWebAt(h.source.url, h.id);
  }
}

export function openDocument(d: Document) {
  if (d.type === "pdf") void chrome.tabs.create({ url: viewerUrl({ doc: d.id }) });
  else if (d.url) void chrome.tabs.create({ url: d.url });
}
