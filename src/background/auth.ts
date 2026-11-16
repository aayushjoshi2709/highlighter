import { resetSyncState } from "./syncState";
import { ACCOUNT_KEY, getAccount, setPrefs, type Account } from "../shared/prefs";

/**
 * Sign-in (identity) and Drive authorisation are separate grants: signing in
 * only asks for the basic profile; the Drive scope is requested when the user
 * turns sync on.
 */
export const PROFILE_SCOPES = ["openid", "email", "profile"];
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export const DRIVE_SCOPES = [...PROFILE_SCOPES, DRIVE_SCOPE];

export class AuthError extends Error {}

export async function getToken(interactive: boolean, scopes: string[]): Promise<string> {
  try {
    const result = (await chrome.identity.getAuthToken({ interactive, scopes })) as unknown;
    const token = typeof result === "string" ? result : (result as { token?: string } | undefined)?.token;
    if (!token) throw new Error("No token returned");
    return token;
  } catch (e) {
    throw new AuthError(e instanceof Error ? e.message : String(e));
  }
}

/** fetch() with a Google access token; refreshes the token once if it has expired. */
export async function authorizedFetch(url: string, init: RequestInit = {}, scopes: string[] = DRIVE_SCOPES): Promise<Response> {
  let token = await getToken(false, scopes);
  const run = (t: string) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` } });
  let res = await run(token);
  if (res.status === 401) {
    await chrome.identity.removeCachedAuthToken({ token });
    token = await getToken(false, scopes);
    res = await run(token);
    if (res.status === 401) throw new AuthError("Google authorisation expired. Please sign in again.");
  }
  return res;
}

export async function signIn(): Promise<Account> {
  await getToken(true, PROFILE_SCOPES);
  const res = await authorizedFetch("https://www.googleapis.com/oauth2/v3/userinfo", {}, PROFILE_SCOPES);
  if (!res.ok) throw new AuthError(`Could not read Google profile (${res.status})`);
  const info = (await res.json()) as { sub: string; email: string; name?: string; picture?: string };
  const account: Account = { id: info.sub, email: info.email, name: info.name, picture: info.picture };
  const previous = await getAccount();
  // Sync state belongs to one Google account; a different account starts clean.
  if (previous?.id !== account.id) await resetSyncState(account.id);
  await chrome.storage.local.set({ [ACCOUNT_KEY]: account });
  return account;
}

/** Signs out and disconnects: revokes the grant and stops sync. Local data is kept. */
export async function signOut(): Promise<void> {
  try {
    const token = await getToken(false, PROFILE_SCOPES);
    await chrome.identity.removeCachedAuthToken({ token });
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" });
  } catch {
    // Already signed out or offline; still clear local state below.
  }
  await chrome.identity.clearAllCachedAuthTokens();
  await setPrefs({ syncEnabled: false });
  await chrome.storage.local.remove(ACCOUNT_KEY);
}

/** Asks for the Drive scope (interactive). */
export async function authorizeDrive(): Promise<void> {
  await getToken(true, DRIVE_SCOPES);
}
