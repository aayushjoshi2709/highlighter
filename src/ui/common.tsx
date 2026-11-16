import { useEffect, useState } from "react";
import { COLOR_HEX, COLOR_LABEL } from "../shared/colors";
import {
  ACCOUNT_KEY, DEFAULT_PREFS, SYNC_STATUS_KEY, getAccount, getPrefs, getSyncStatus, onPrefsChanged, onStorageKey,
  type Account, type Prefs, type SyncStatus,
} from "../shared/prefs";
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
