import { authorizedFetch } from "./auth";

/** Minimal Google Drive v3 client restricted to the hidden appDataFolder. */

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export interface DriveFile {
  id: string;
  name: string;
  createdTime: string;
  modifiedTime: string;
  size?: string;
}

async function check(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  let detail = "";
  try {
    detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
  } catch {
    /* not JSON */
  }
  throw new Error(`Drive ${what} failed (${res.status})${detail ? `: ${detail}` : ""}`);
}

export async function listFiles(query?: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      spaces: "appDataFolder",
      fields: "nextPageToken,files(id,name,createdTime,modifiedTime,size)",
      pageSize: "1000",
      orderBy: "createdTime",
    });
    if (query) params.set("q", query);
    if (pageToken) params.set("pageToken", pageToken);
    const res = await check(await authorizedFetch(`${API}?${params}`), "list");
    const body = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(body.files ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return files;
}

export async function downloadJson(id: string): Promise<unknown> {
  const res = await check(await authorizedFetch(`${API}/${id}?alt=media`), "download");
  return res.json();
}

export async function downloadBlob(id: string): Promise<Blob> {
  const res = await check(await authorizedFetch(`${API}/${id}?alt=media`), "download");
  return res.blob();
}

export async function createFile(name: string, content: Blob): Promise<DriveFile> {
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({ name, parents: ["appDataFolder"] })], { type: "application/json" }));
  form.append("file", content);
  const res = await check(
    await authorizedFetch(`${UPLOAD}?uploadType=multipart&fields=id,name,createdTime,modifiedTime`, { method: "POST", body: form }),
    "upload",
  );
  return res.json();
}

export async function updateFile(id: string, content: Blob): Promise<DriveFile> {
  const res = await check(
    await authorizedFetch(`${UPLOAD}/${id}?uploadType=media&fields=id,name,createdTime,modifiedTime`, {
      method: "PATCH",
      headers: { "Content-Type": content.type || "application/octet-stream" },
      body: content,
    }),
    "update",
  );
  return res.json();
}

export async function deleteFile(id: string): Promise<void> {
  const res = await authorizedFetch(`${API}/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) await check(res, "delete");
}
