import { useEffect, useState } from "react";
import { COLOR_HEX, COLOR_LABEL } from "../shared/colors";
import {
  ACCOUNT_KEY, DEFAULT_PREFS, SYNC_STATUS_KEY, getAccount, getPrefs, getSyncStatus, onPrefsChanged, onStorageKey,
  type Account, type Prefs, type SyncStatus,
} from "../shared/prefs";
import { GITHUB_REPO_URL } from "../shared/constants";
import { HIGHLIGHT_COLORS, type HighlightColor } from "../shared/types";

export function Swatches(props: { value?: HighlightColor | null; onPick: (c: HighlightColor) => void; size?: number }) {
  const size = props.size ?? 20;
  return (
    <span className="inline-flex items-center gap-1.5">
      {HIGHLIGHT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          title={COLOR_LABEL[c]}
          aria-label={COLOR_LABEL[c]}
          aria-pressed={props.value === c}
          onClick={(e) => {
            e.stopPropagation();
            props.onPick(c);
          }}
          className={`rounded-full border-2 transition-transform hover:scale-110 ${props.value === c ? "border-slate-700" : "border-transparent ring-1 ring-black/10"}`}
          style={{ background: COLOR_HEX[c], width: size, height: size }}
        />
      ))}
    </span>
  );
}

export function usePrefs(): Prefs {
  const [prefs, set] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => {
    void getPrefs().then(set);
    return onPrefsChanged(set);
  }, []);
  return prefs;
}

export function useAccount(): Account | null {
  const [account, set] = useState<Account | null>(null);
  useEffect(() => {
    void getAccount().then(set);
    return onStorageKey<Account | undefined>(ACCOUNT_KEY, (v) => set(v ?? null));
  }, []);
  return account;
}

export function useSyncStatus(): SyncStatus {
  const [status, set] = useState<SyncStatus>({ state: "disabled", pending: 0 });
  useEffect(() => {
    void getSyncStatus().then(set);
    return onStorageKey<SyncStatus | undefined>(SYNC_STATUS_KEY, (v) => v && set(v));
  }, []);
  return status;
}

export function syncLabel(status: SyncStatus, signedIn: boolean, enabled: boolean): { text: string; tone: string } {
  const waiting = `${status.pending} change${status.pending === 1 ? "" : "s"} waiting`;
  if (!signedIn) return { text: "Saved on this device only", tone: "bg-slate-400" };
  if (!enabled) return { text: "Drive sync is off", tone: "bg-slate-400" };
  switch (status.state) {
    case "syncing":
      return { text: "Syncing…", tone: "bg-blue-500" };
    case "error":
      return { text: status.error ?? "Sync error", tone: "bg-red-500" };
    case "offline":
      return { text: `Offline · ${waiting}`, tone: "bg-amber-500" };
    default:
      if (status.pending) return { text: `${waiting} to sync`, tone: "bg-amber-500" };
      return { text: status.lastSyncedAt ? `Synced ${new Date(status.lastSyncedAt).toLocaleTimeString()}` : "Sync is on", tone: "bg-emerald-500" };
  }
}

export function SyncDot() {
  const status = useSyncStatus();
  const account = useAccount();
  const prefs = usePrefs();
  const { text, tone } = syncLabel(status, Boolean(account), prefs.syncEnabled);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-slate-500" title={text}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} />
      <span className="truncate">{text}</span>
    </span>
  );
}

/** Link to the source repository; opens in a new tab (also from the popup). */
export function ForkLink(props: { className?: string }) {
  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-700 hover:underline ${props.className ?? ""}`}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 fill-current">
      <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z" />
    </svg>
      Fork it on GitHub
    </a>
  );
}
