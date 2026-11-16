export function newId(): string {
  return crypto.randomUUID();
}

const TRACKING_PARAMS = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|igshid|ref_src)$/i;

/**
 * Canonical form of a page URL used to identify a web document: drops the
 * fragment and common tracking parameters so revisits map to the same document.
 * Hash-routed SPAs ("#/path", "#!/path") keep their fragment.
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (!/^#!?\//.test(u.hash)) u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return raw;
  }
}

export function webDocumentId(url: string): string {
  return `web:${normalizeUrl(url)}`;
}

export function pdfDocumentId(fingerprint: string): string {
  return `pdf:${fingerprint}`;
}

export function domainOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isPdfUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /^(https?|file):$/.test(u.protocol) && /\.pdf$/i.test(u.pathname);
  } catch {
    return false;
  }
}

export function formatDate(ts: number | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function viewerUrl(params: { src?: string; doc?: string; page?: number; highlight?: string }): string {
  const q = new URLSearchParams();
  if (params.src) q.set("src", params.src);
  if (params.doc) q.set("doc", params.doc);
  if (params.page) q.set("page", String(params.page));
  if (params.highlight) q.set("highlight", params.highlight);
  return chrome.runtime.getURL(`pdf/index.html?${q.toString()}`);
}
