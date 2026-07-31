// Admin password for the write side of Ingest & Cài đặt, held for the tab only.
//
// The workspace link goes to a wide audience; everyone reads, only the holder of the
// shared password writes. The real check is in the Worker (services/adminAuth.ts) —
// this module just carries the key on each request and remembers it across an F5.
//
// sessionStorage, like the bring-your-own LLM keys: a reload keeps it, a new tab or a
// closed tab does not, so an unlocked session cannot be left behind on a shared
// machine. The key rides in a header, never a query parameter.

const STORAGE_KEY = "cfl.admin.key.v1";

export const ADMIN_HEADER = "X-CFL-Admin-Key";

export function getAdminKey() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null; // private mode, or storage refused
  }
}

export function setAdminKey(key) {
  try {
    if (key) sessionStorage.setItem(STORAGE_KEY, key);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing useful to do if the tab refuses storage */
  }
}

export function clearAdminKey() {
  setAdminKey(null);
}
