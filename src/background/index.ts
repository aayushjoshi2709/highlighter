import { authorizeDrive, signIn, signOut } from "./auth";
import { pendingCount, setStatus, syncNow } from "./sync";
import { db } from "../shared/db";
import type { BgRequest, BgResponse, ContentRequest } from "../shared/messages";
import { CHANGE_KEY, getPrefs, setPrefs, type ChangeNotice } from "../shared/prefs";
import { createHighlight, deleteHighlights, highlightsForDocument, updateHighlight } from "../shared/repo";
import { isPdfUrl, viewerUrl } from "../shared/util";

const ALARM_PERIODIC = "sync-periodic";
const ALARM_SOON = "sync-soon";
const MENU_HIGHLIGHT = "highlight-selection";
const MENU_OPEN_PDF = "open-pdf";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_HIGHLIGHT, title: "Highlight selection", contexts: ["selection"] });
    chrome.contextMenus.create({
      id: MENU_OPEN_PDF,
      title: "Open PDF in Highlighter",
      contexts: ["link"],
      targetUrlPatterns: ["*://*/*.pdf", "*://*/*.pdf?*", "*://*/*.PDF"],
    });
  });
  void chrome.alarms.create(ALARM_PERIODIC, { periodInMinutes: 15 });
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create(ALARM_PERIODIC, { periodInMinutes: 15 });
  void syncNow();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_PERIODIC || alarm.name === ALARM_SOON) void syncNow();
});

// A local change schedules a push shortly afterwards (batched by the alarm).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[CHANGE_KEY]) return;
  const notice = changes[CHANGE_KEY].newValue as ChangeNotice | undefined;
  if (notice?.origin !== "local") return;
  void pendingCount().then((pending) => setStatus({ pending }));
  void getPrefs().then((p) => {
    if (p.syncEnabled) void chrome.alarms.create(ALARM_SOON, { delayInMinutes: 0.5 });
  });
});

async function sendToTab(tabId: number | undefined, msg: ContentRequest) {
  if (tabId === undefined) return;
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // No content script on this page (chrome://, Web Store, PDF viewer…).
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_HIGHLIGHT) void sendToTab(tab?.id, { type: "content:highlightSelection" });
  if (info.menuItemId === MENU_OPEN_PDF && info.linkUrl) void chrome.tabs.create({ url: viewerUrl({ src: info.linkUrl }) });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "highlight-selection") void sendToTab(tab?.id, { type: "content:highlightSelection" });
});

// PDFs opened in Chrome are handed to the extension's own PDF.js viewer,
// because scripts cannot be injected into Chrome's built-in viewer.
const nativePdfOnce = new Set<string>();
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const url = changeInfo.url;
  if (!url || !isPdfUrl(url)) return;
  if (nativePdfOnce.delete(url)) return;
  void getPrefs().then((p) => {
    if (p.openPdfsInViewer) void chrome.tabs.update(tabId, { url: viewerUrl({ src: url }) });
  });
});

async function setBadge(tabId: number | undefined, count: number) {
  if (tabId === undefined) return;
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#f59e0b" });
  await chrome.action.setBadgeText({ tabId, text: count ? String(count) : "" });
}

async function handle(req: BgRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (req.type) {
    case "page:load": {
      // Pages without highlights leave no trace: a document row is only created with its first highlight.
      const doc = await db.documents.get(req.document.id);
      if (doc && !doc.deletedAt) await db.documents.update(doc.id, { lastOpenedAt: Date.now() });
      const highlights = doc && !doc.deletedAt ? await highlightsForDocument(doc.id) : [];
      void setBadge(sender.tab?.id, highlights.length);
      return { highlights };
    }
    case "highlight:create": {
      const h = await createHighlight(req);
      void highlightsForDocument(h.source.documentId).then((all) => setBadge(sender.tab?.id, all.length));
      return h;
    }
    case "highlight:update":
      return updateHighlight(req.id, req.patch);
    case "highlight:delete": {
      const h = await db.highlights.get(req.id);
      await deleteHighlights([req.id]);
      if (h) void highlightsForDocument(h.source.documentId).then((all) => setBadge(sender.tab?.id, all.length));
      return null;
    }
    case "auth:signIn":
      return signIn();
    case "auth:signOut":
      await signOut();
      await setStatus({ state: "disabled" });
      return null;
    case "sync:enable":
      await authorizeDrive();
      await setPrefs({ syncEnabled: true });
      void syncNow();
      return null;
    case "sync:disable":
      await setPrefs({ syncEnabled: false });
      await setStatus({ state: "disabled" });
      return null;
    case "sync:now":
      await syncNow();
      return null;
    case "dashboard:open":
      await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/index.html") });
      return null;
    case "pdf:openNative": {
      nativePdfOnce.add(req.url);
      if (sender.tab?.id !== undefined) await chrome.tabs.update(sender.tab.id, { url: req.url });
      return null;
    }
  }
}

chrome.runtime.onMessage.addListener((req: BgRequest, sender, sendResponse: (r: BgResponse) => void) => {
  if (!req || typeof req.type !== "string" || req.type.startsWith("content:")) return false;
  handle(req, sender).then(
    (data) => sendResponse({ ok: true, data }),
    (e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }),
  );
  return true; // async response
});
