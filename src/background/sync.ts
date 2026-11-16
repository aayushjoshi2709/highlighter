import { AuthError } from "./auth";
import * as drive from "./drive";
import { getMeta, setMeta } from "./syncState";
import { db } from "../shared/db";
import { mergeBundle } from "../shared/merge";
import { SYNC_STATUS_KEY, getAccount, getPrefs, type SyncStatus } from "../shared/prefs";
import { getDeviceId, notifyChange } from "../shared/repo";
import { DataBundleSchema, type DataBundle, type SyncOperation } from "../shared/types";

/**
 * Incremental sync over Drive's appDataFolder.
 *
 *  - Each push uploads only the entities changed since the last push, as an
 *    immutable file `ops_<time>_<deviceId>.json`.
 *  - Each pull downloads only op files this device has not applied yet.
 *  - Entities merge by last-writer-wins on `updatedAt`; deletions travel as
 *    tombstones. Merging is idempotent, so replays are harmless.
 *  - When op files pile up, one device folds everything it has into
 *    `snapshot.json` and removes the op files it folded in.
 */

const SNAPSHOT = "snapshot.json";
const OPS_PREFIX = "ops_";
const COMPACT_AFTER = 40;

export async function pendingCount(): Promise<number> {
  return db.syncQueue.count();
}

export async function setStatus(patch: Partial<SyncStatus>): Promise<void> {
  const current = ((await chrome.storage.local.get(SYNC_STATUS_KEY))[SYNC_STATUS_KEY] ?? { state: "disabled", pending: 0 }) as SyncStatus;
  const next: SyncStatus = { ...current, ...patch, pending: await pendingCount() };
  if (patch.state && patch.state !== "error") delete next.error;
  await chrome.storage.local.set({ [SYNC_STATUS_KEY]: next });
}

function toBlob(bundle: DataBundle): Blob {
  return new Blob([JSON.stringify(bundle)], { type: "application/json" });
}

async function fullBundle(deviceId: string): Promise<DataBundle> {
  return {
    format: "web-pdf-highlighter",
    version: 1,
    exportedAt: Date.now(),
    deviceId,
    highlights: await db.highlights.toArray(), // tombstones included on purpose
    documents: await db.documents.toArray(),
    collections: await db.collections.toArray(),
    tags: await db.tags.toArray(),
  };
}

async function bundleForOps(ops: SyncOperation[], deviceId: string): Promise<DataBundle> {
  const ids = (type: SyncOperation["entityType"]) => ops.filter((o) => o.entityType === type).map((o) => o.entityId);
  const present = <T>(rows: (T | undefined)[]) => rows.filter((r): r is T => Boolean(r));
  return {
    format: "web-pdf-highlighter",
    version: 1,
    exportedAt: Date.now(),
    deviceId,
    highlights: present(await db.highlights.bulkGet(ids("highlight"))),
    documents: present(await db.documents.bulkGet(ids("document"))),
    collections: present(await db.collections.bulkGet(ids("collection"))),
    tags: present(await db.tags.bulkGet(ids("tag"))),
  };
}

function stripLocal(bundle: DataBundle): DataBundle {
  // lastOpenedAt/localFile describe this device only.
  return { ...bundle, documents: bundle.documents.map(({ localFile: _l, lastOpenedAt: _o, ...d }) => d) };
}

async function applyRemote(raw: unknown): Promise<string[]> {
  const parsed = DataBundleSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[Highlighter] Ignoring malformed sync file", parsed.error.issues.slice(0, 3));
    return [];
  }
  return (await mergeBundle(parsed.data)).documentIds;
}

let running: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  running ??= runSync().finally(() => (running = null));
  return running;
}

async function runSync(): Promise<void> {
  const [prefs, account] = await Promise.all([getPrefs(), getAccount()]);
  if (!prefs.syncEnabled || !account) return setStatus({ state: "disabled" });
  if (!navigator.onLine) return setStatus({ state: "offline" });

  await setStatus({ state: "syncing" });
  try {
    const deviceId = await getDeviceId();
    const remote = await drive.listFiles();
    const snapshot = remote.find((f) => f.name === SNAPSHOT);
    let opFiles = remote.filter((f) => f.name.startsWith(OPS_PREFIX));
    const applied = new Set(await getMeta<string[]>("appliedFiles", []));
    const touchedDocs: string[] = [];

    // ---- pull
    if (snapshot && snapshot.modifiedTime !== (await getMeta<string>("snapshotVersion", ""))) {
      touchedDocs.push(...(await applyRemote(await drive.downloadJson(snapshot.id))));
      await setMeta("snapshotVersion", snapshot.modifiedTime);
    }
    for (const file of opFiles) {
      if (applied.has(file.id)) continue;
      if (!file.name.includes(deviceId)) touchedDocs.push(...(await applyRemote(await drive.downloadJson(file.id))));
      applied.add(file.id);
    }
    if (touchedDocs.length) notifyChange(touchedDocs, "remote");

    // ---- push
    const queue = await db.syncQueue.toArray();
    const fullPush = await getMeta("needsFullPush", false);
    if (queue.length || fullPush) {
      const bundle = stripLocal(fullPush ? await fullBundle(deviceId) : await bundleForOps(queue, deviceId));
      const hasData = bundle.highlights.length + bundle.documents.length + bundle.collections.length + bundle.tags.length > 0;
      if (hasData) {
        const created = await drive.createFile(`${OPS_PREFIX}${Date.now()}_${deviceId}.json`, toBlob(bundle));
        applied.add(created.id);
        opFiles = [...opFiles, created];
      }
      // Only the operations that were uploaded; anything queued meanwhile has a new id.
      await db.syncQueue.bulkDelete(queue.map((o) => o.id));
      if (fullPush) await setMeta("needsFullPush", false);
    }

    // ---- compact
    if (opFiles.length > COMPACT_AFTER) {
      const blob = toBlob(stripLocal(await fullBundle(deviceId)));
      const saved = snapshot ? await drive.updateFile(snapshot.id, blob) : await drive.createFile(SNAPSHOT, blob);
      await setMeta("snapshotVersion", saved.modifiedTime);
      // Everything in opFiles has been merged locally, so it is contained in the snapshot.
      for (const f of opFiles) {
        await drive.deleteFile(f.id);
        applied.delete(f.id);
      }
      opFiles = [];
    }
    const live = new Set(opFiles.map((f) => f.id));
    await setMeta("appliedFiles", [...applied].filter((id) => live.has(id)));

    if (prefs.backupPdfFiles) await backupPdfFiles(remote);

    const now = Date.now();
    await setMeta("lastSyncedAt", now);
    await setStatus({ state: "idle", lastSyncedAt: now });
  } catch (e) {
    const message = e instanceof AuthError ? `Google authorisation needed: ${e.message}` : e instanceof Error ? e.message : String(e);
    await setStatus({ state: navigator.onLine ? "error" : "offline", error: message });
  }
}

const pdfBackupName = (documentId: string) => `pdf_${documentId.replace(/^pdf:/, "")}.pdf`;

/** Opt-in: uploads imported PDFs that have not been backed up yet. */
async function backupPdfFiles(remote: drive.DriveFile[]): Promise<void> {
  const files = await db.pdfFiles.toArray();
  for (const f of files) {
    if (f.driveFileId && remote.some((r) => r.id === f.driveFileId)) continue;
    const existing = remote.find((r) => r.name === pdfBackupName(f.documentId));
    const id = existing?.id ?? (await drive.createFile(pdfBackupName(f.documentId), new Blob([f.blob], { type: "application/pdf" }))).id;
    await db.pdfFiles.update(f.documentId, { driveFileId: id });
  }
}

/** Fetches a backed-up PDF onto this device, if one exists. */
export async function restorePdfBackup(documentId: string, name: string): Promise<boolean> {
  const [match] = await drive.listFiles(`name = '${pdfBackupName(documentId).replace(/'/g, "\\'")}'`);
  if (!match) return false;
  const blob = await drive.downloadBlob(match.id);
  await db.pdfFiles.put({ documentId, name, blob, size: blob.size, addedAt: Date.now(), driveFileId: match.id });
  await db.documents.update(documentId, { localFile: true });
  return true;
}
