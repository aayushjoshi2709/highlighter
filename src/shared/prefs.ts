import type { HighlightColor } from "./types";

/**
 * Lightweight preferences live in chrome.storage.local (readable from content
 * scripts). All user data lives in IndexedDB.
 */
export type Theme = "system" | "light" | "dark";

export interface Prefs {
  defaultColor: HighlightColor;
  /** Redirect PDFs opened in Chrome to the extension viewer. */
  openPdfsInViewer: boolean;
  /** Drive sync switch; separate from being signed in. */
  syncEnabled: boolean;
  /** Opt-in: also back up imported PDF files to Drive. */
  backupPdfFiles: boolean;
  /** Color theme of the popup, dashboard and PDF viewer. */
  theme: Theme;
}

export const DEFAULT_PREFS: Prefs = {
  defaultColor: "yellow",
  openPdfsInViewer: true,
  syncEnabled: false,
  backupPdfFiles: false,
  theme: "system",
};

export interface Account {
  id: string;
  email: string;
  name?: string;
  picture?: string;
}

export interface SyncStatus {
  state: "idle" | "syncing" | "error" | "offline" | "disabled";
  lastSyncedAt?: number;
  pending: number;
  error?: string;
}

const PREFS_KEY = "prefs";
export const ACCOUNT_KEY = "account";
export const SYNC_STATUS_KEY = "syncStatus";
/** Bumped after every local data change so other contexts can react. */
export const CHANGE_KEY = "lastChange";

export async function getPrefs(): Promise<Prefs> {
  const r = await chrome.storage.local.get(PREFS_KEY);
  return { ...DEFAULT_PREFS, ...(r[PREFS_KEY] ?? {}) };
}

export async function setPrefs(patch: Partial<Prefs>): Promise<Prefs> {
  const next = { ...(await getPrefs()), ...patch };
  await chrome.storage.local.set({ [PREFS_KEY]: next });
  return next;
}

export function onPrefsChanged(cb: (prefs: Prefs) => void): () => void {
  const l = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[PREFS_KEY]) cb({ ...DEFAULT_PREFS, ...changes[PREFS_KEY].newValue });
  };
  chrome.storage.onChanged.addListener(l);
  return () => chrome.storage.onChanged.removeListener(l);
}

export async function getAccount(): Promise<Account | null> {
  return (await chrome.storage.local.get(ACCOUNT_KEY))[ACCOUNT_KEY] ?? null;
}

export async function getSyncStatus(): Promise<SyncStatus> {
  return (await chrome.storage.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] ?? { state: "disabled", pending: 0 };
}

export interface ChangeNotice {
  at: number;
  documentIds: string[];
  /** "remote" when the change was applied by sync, so it is not re-queued. */
  origin: "local" | "remote";
}

export function onStorageKey<T>(key: string, cb: (value: T) => void): () => void {
  const l = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && changes[key]) cb(changes[key].newValue as T);
  };
  chrome.storage.onChanged.addListener(l);
  return () => chrome.storage.onChanged.removeListener(l);
}
