import { db } from "../shared/db";

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.syncMetadata.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.syncMetadata.put({ key, value });
}

/** Forgets what has been exchanged with Drive so the next sync pulls and pushes everything. */
export async function resetSyncState(accountId: string): Promise<void> {
  await db.syncMetadata.bulkDelete(["appliedFiles", "snapshotVersion", "lastSyncedAt"]);
  await setMeta("accountId", accountId);
  await setMeta("needsFullPush", true);
}
