// TEMPORARY. One-shot way to get a locally-imported libSQL file onto a Dokploy volume
// when there is no SSH to the host and Dokploy's Application volumes have no upload UI
// (checked the whole Advanced/Volumes panel — rename and delete only).
//
// Delete this file and its one line of wiring in nodeServer.ts once the data move for
// this deploy is done. It is not meant to live in the codebase long-term: replacing the
// database wholesale is a much bigger hammer than anything else behind ADMIN_PASSWORD.
import { renameSync, unlinkSync, writeFileSync } from "node:fs";

/**
 * Retries a rename past a transient lock. Windows in particular can hold a just-closed
 * file's handle open for a moment after close() returns (the native SQLite binding's
 * cleanup isn't synchronous with the JS call) — a bare renameSync can lose that race.
 */
function renameWithRetry(from: string, to: string, attempts = 20, delayMs = 50): void {
  for (let i = 0; i < attempts; i += 1) {
    try {
      renameSync(from, to);
      return;
    } catch (e: any) {
      if (i === attempts - 1 || (e?.code !== "EPERM" && e?.code !== "EBUSY")) throw e;
      const until = Date.now() + delayMs;
      while (Date.now() < until) {
        /* deliberately blocking: this handler already has the request body in memory
           and nothing else can usefully happen until the OS releases the file */
      }
    }
  }
}

const SQLITE_MAGIC = "SQLite format 3\0";
export const REPLACE_DB_PATH = "/__node-admin/replace-db";

/** Timing-safe-ish compare; matches the one in adminAuth.ts without importing D1 types. */
function secureEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface ReplaceDbOptions {
  /** Absolute path to the live database file (the LIBSQL_URL, minus "file:"). */
  dbPath: string;
  adminPassword: string;
  /**
   * Closes the process's own open connection to dbPath before the swap.
   *
   * Skipping this fails outright on Windows (rename over an open handle is EPERM) and
   * is wrong on Linux too even though rename succeeds there: the process's existing file
   * descriptor still points at the old inode after rename, so every query would keep
   * hitting the OLD data until something reopens the connection. A restart is required
   * after a successful replace either way — this just makes that unavoidable instead of
   * silently serving stale data in the meantime.
   */
  closeDb?: () => void;
}

/**
 * A fetch handler for exactly one route. Returns null for anything else, so it can sit
 * in front of the real app and fall through untouched.
 */
export function createReplaceDbHandler(options: ReplaceDbOptions) {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    if (url.pathname !== REPLACE_DB_PATH || request.method !== "POST") return null;

    // Inverted from every other admin route on purpose: those fail OPEN with no password
    // configured (see adminAuth.ts — a fresh deploy must not lock its own owner out).
    // Replacing the whole database is destructive enough that this route fails CLOSED
    // instead: no password set means no one can call it, full stop.
    const provided = request.headers.get("X-CFL-Admin-Key") ?? "";
    if (!options.adminPassword || !secureEquals(options.adminPassword, provided)) {
      return Response.json({ detail: "unauthorized" }, { status: 401 });
    }

    const body = new Uint8Array(await request.arrayBuffer());
    const magic = Buffer.from(body.subarray(0, SQLITE_MAGIC.length)).toString("ascii");
    if (magic !== SQLITE_MAGIC) {
      // The one guard between "authenticated admin" and "arbitrary bytes become the
      // production database" — keeps this from being a blind write-anything primitive.
      return Response.json({ detail: "not a SQLite file (bad header)" }, { status: 400 });
    }

    options.closeDb?.();
    // Windows-only quirk: the native libsql binding's file handle is tied to the JS
    // wrapper's finalizer, not released synchronously by close() (confirmed: the same
    // rename still EPERMs a full second after close() without this). Linux, the actual
    // deploy target, does not have this problem — POSIX rename() does not care whether
    // any process has the destination open. A no-op when --expose-gc was not passed.
    (global as any).gc?.();

    // Write beside the target, then rename over it. rename() is atomic on the same
    // filesystem, so a reader never sees a half-written file — worst case it still sees
    // the old one until the swap completes.
    const tmpPath = `${options.dbPath}.upload-${Date.now()}`;
    try {
      writeFileSync(tmpPath, body);
      renameWithRetry(tmpPath, options.dbPath);
    } catch (e) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Nothing to clean up if the write itself never landed.
      }
      throw e;
    }

    return Response.json({ ok: true, bytes_written: body.length });
  };
}
