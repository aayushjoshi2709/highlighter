import { useState, type ReactNode } from "react";
import { sendBg, type BgRequest } from "../../shared/messages";
import { setPrefs, type Theme } from "../../shared/prefs";
import { ForkLink, Swatches, SyncDot, useAccount, usePrefs } from "../../ui/common";
import { exportJson, exportMarkdown, importJson } from "./io";

function Card(props: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-3 font-semibold">{props.title}</h2>
      {props.children}
    </section>
  );
}

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 py-1.5 ${props.disabled ? "opacity-50" : ""}`}>
      <input type="checkbox" className="mt-1" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span>
        <span className="block text-sm">{props.label}</span>
        {props.hint && <span className="block text-xs text-slate-500">{props.hint}</span>}
      </span>
    </label>
  );
}

const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

export function Settings() {
  const account = useAccount();
  const prefs = usePrefs();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const run = async (req: BgRequest, done?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await sendBg(req);
      if (done) setMessage({ tone: "ok", text: done });
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-6">
      <h1 className="mb-4 text-xl font-semibold">Settings</h1>
      {message && (
        <p role="status" className={`mb-4 rounded-md px-3 py-2 text-sm ${message.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
          {message.text}
        </p>
      )}

      <Card title="Google account">
        {account ? (
          <div className="flex items-center gap-3">
            {account.picture && <img src={account.picture} alt="" className="h-10 w-10 rounded-full" referrerPolicy="no-referrer" />}
            <div className="min-w-0 flex-1">
              {account.name && <div className="truncate text-sm font-medium">{account.name}</div>}
              <div className="truncate text-sm text-slate-500">{account.email}</div>
            </div>
            <button className="btn" disabled={busy} onClick={() => void run({ type: "auth:signOut" }, "Signed out. Your highlights are still on this device.")}>
              Sign out & disconnect
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">Sign in to sync highlights between your devices. Highlighting works without an account.</p>
            <button className="btn-primary shrink-0" disabled={busy} onClick={() => void run({ type: "auth:signIn" })}>Sign in with Google</button>
          </div>
        )}
      </Card>

      <Card title="Google Drive sync">
        <p className="mb-2 text-xs text-slate-500">
          Signing in and syncing are separate: sync needs your permission to store data in a hidden app folder in your Drive. The extension cannot see your other files.
        </p>
        <Toggle
          checked={prefs.syncEnabled}
          disabled={!account || busy}
          label="Sync highlights with Google Drive"
          hint={account ? "Changes are saved locally first and uploaded in the background." : "Sign in first."}
          onChange={(on) => void run({ type: on ? "sync:enable" : "sync:disable" })}
        />
        <Toggle
          checked={prefs.backupPdfFiles}
          disabled={!prefs.syncEnabled}
          label="Also back up imported PDF files"
          hint="Off by default. Without this, only annotations sync – the PDF itself must be imported on each device."
          onChange={(on) => void setPrefs({ backupPdfFiles: on })}
        />
        <div className="mt-3 flex items-center gap-3">
          <button className="btn" disabled={!prefs.syncEnabled || busy} onClick={() => void run({ type: "sync:now" })}>Sync now</button>
          <SyncDot />
        </div>
      </Card>

      <Card title="Appearance">
        <div className="flex items-center gap-3 text-sm">
          Theme
          <div role="radiogroup" aria-label="Theme" className="inline-flex overflow-hidden rounded-md border border-slate-300">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={prefs.theme === t.id}
                onClick={() => void setPrefs({ theme: t.id })}
                className={`px-3 py-1.5 text-sm ${prefs.theme === t.id ? "bg-blue-600 font-medium text-onaccent" : "bg-white text-slate-700 hover:bg-slate-100"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">System follows your device setting. PDF pages keep their original colors.</p>
      </Card>

      <Card title="Highlighting">
        <div className="mb-2 flex items-center gap-3 text-sm">
          Default color
          <Swatches value={prefs.defaultColor} onPick={(defaultColor) => void setPrefs({ defaultColor })} />
        </div>
        <Toggle
          checked={prefs.openPdfsInViewer}
          label="Open PDFs in the Highlighter viewer"
          hint="Chrome's built-in PDF viewer cannot be highlighted, so links ending in .pdf open in the extension's viewer."
          onChange={(on) => void setPrefs({ openPdfsInViewer: on })}
        />
        <p className="mt-1 text-xs text-slate-500">Shortcut: Alt+Shift+H highlights the current selection (change it at chrome://extensions/shortcuts).</p>
      </Card>

      <Card title="Your data">
        <p className="mb-3 text-sm text-slate-600">Export everything to a file you control, or import a previous export. Importing merges; it never removes highlights.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => void exportJson()}>Export all (JSON)</button>
          <button className="btn" onClick={() => void exportMarkdown()}>Export all (Markdown)</button>
          <label className="btn cursor-pointer">
            Import JSON…
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                importJson(file).then(
                  (n) => setMessage({ tone: "ok", text: n ? `Imported ${n} record${n === 1 ? "" : "s"}.` : "Nothing new in that file." }),
                  (err) => setMessage({ tone: "error", text: err instanceof Error ? err.message : String(err) }),
                );
              }}
            />
          </label>
        </div>
      </Card>

      <Card title="About">
        <p className="mb-2 text-sm text-slate-600">Highlighter is open source. Fork it, report issues or contribute on GitHub.</p>
        <ForkLink />
      </Card>
    </div>
  );
}
