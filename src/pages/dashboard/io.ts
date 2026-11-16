import { bundleToMarkdown, exportBundle, mergeBundle } from "../../shared/merge";
import { db } from "../../shared/db";
import { getDeviceId, notifyChange } from "../../shared/repo";
import { DataBundleSchema, ENTITY_TYPES } from "../../shared/types";
import { newId } from "../../shared/util";

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export async function exportJson(ids?: string[]) {
  download(`highlights-${stamp()}.json`, JSON.stringify(await exportBundle(ids), null, 2), "application/json");
}

export async function exportMarkdown(ids?: string[]) {
  download(`highlights-${stamp()}.md`, bundleToMarkdown(await exportBundle(ids)), "text/markdown");
}

/** Validates and merges an export file. Newer copies win; nothing local is discarded otherwise. */
export async function importJson(file: File): Promise<number> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  const parsed = DataBundleSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Not a Highlighter export: ${issue.path.join(".") || "file"} – ${issue.message}`);
  }
  const result = await mergeBundle(parsed.data);
  // Imported records are local changes from Drive's point of view.
  const deviceId = await getDeviceId();
  const now = Date.now();
  await db.syncQueue.bulkPut(
    ENTITY_TYPES.flatMap((entityType) =>
      result.changed[entityType].map((entityId) => ({ id: newId(), entityType, entityId, operation: "upsert" as const, timestamp: now, deviceId })),
    ),
  );
  notifyChange(result.documentIds);
  return result.applied;
}
