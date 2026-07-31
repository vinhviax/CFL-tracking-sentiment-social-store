import type { MiddlewareHandler } from "hono";
import type { Env } from "../types";

/**
 * Shared-password lock for the write side of Ingest & Cài đặt.
 *
 * The workspace link is handed to a wide audience who should be able to read every
 * panel, so the lock cannot live in the UI alone: the destructive endpoints (delete a
 * run, pull a range, re-analyse, change the LLM provider) are reachable with a single
 * curl once the origin is known. This middleware is the actual boundary; the disabled
 * buttons in the frontend only mirror it.
 *
 * The key is the password itself rather than a signed session token. There is one
 * shared credential and no user identity to encode, so a token would add rotation and
 * expiry machinery without protecting anything more — and the browser already holds
 * far more sensitive material (the bring-your-own LLM keys) under the same policy.
 */

export const ADMIN_HEADER = "X-CFL-Admin-Key";

/** Reads never need the key, so viewers keep every panel and every poll. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(String(method || "").toUpperCase());
}

function adminPassword(env: Env): string {
  return (env.ADMIN_PASSWORD || "").trim();
}

/**
 * Whether this deployment has a password at all.
 *
 * With none set the worker stays open. Failing closed instead would brick the owner's
 * own controls the moment the code ships and before `wrangler secret put` runs, so the
 * warning is raised in the UI (via /api/admin/status) rather than by locking everyone
 * out of a workspace that has no way back in.
 */
export function isAdminLockEnabled(env: Env): boolean {
  return adminPassword(env).length > 0;
}

/** Compare without leaking the match position through timing. */
function secureEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when the caller may write. An open deployment authorises everyone. */
export function isAuthorized(env: Env, key: string | undefined | null): boolean {
  const expected = adminPassword(env);
  if (!expected) return true;
  return secureEquals(expected, String(key ?? ""));
}

export const requireAdmin: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  if (isSafeMethod(c.req.method)) return next();
  if (isAuthorized(c.env, c.req.header(ADMIN_HEADER))) return next();
  return c.json(
    { detail: "Thao tác này cần mật khẩu quản trị. Bấm “Mở khóa chỉnh sửa” ở trang Ingest & Cài đặt." },
    401
  );
};
