import type { DocumentInput, HighlightPatch } from "./repo";
import type { Anchor, Highlight, HighlightColor } from "./types";

/** Content script / pages -> service worker. */
export type BgRequest =
  | { type: "page:load"; document: DocumentInput }
  | { type: "highlight:create"; document: DocumentInput; anchor: Anchor; color: HighlightColor; note?: string }
  | { type: "highlight:update"; id: string; patch: HighlightPatch }
  | { type: "highlight:delete"; id: string }
  | { type: "auth:signIn" }
  | { type: "auth:signOut" }
  | { type: "sync:enable" }
  | { type: "sync:disable" }
  | { type: "sync:now" }
  | { type: "dashboard:open" }
  | { type: "pdf:openNative"; url: string };

export type BgResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

/** Service worker / popup -> content script. */
export type ContentRequest =
  | { type: "content:state" }
  | { type: "content:highlightSelection"; color?: HighlightColor }
  | { type: "content:scrollTo"; id: string }
  | { type: "content:repair"; id: string };

export interface ContentState {
  documentId: string;
  highlights: Highlight[];
  orphanIds: string[];
}

export async function sendBg<T = unknown>(req: BgRequest): Promise<T> {
  const res = (await chrome.runtime.sendMessage(req)) as BgResponse<T> | undefined;
  if (!res) throw new Error("No response from the extension service worker");
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
