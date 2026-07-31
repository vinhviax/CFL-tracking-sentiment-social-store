import { Hono } from "hono";
import { ADMIN_HEADER, isAdminLockEnabled, isAuthorized } from "../services/adminAuth";
import type { Env } from "../types";

/**
 * The lock's own endpoints. Deliberately not behind requireAdmin — /unlock is the way
 * in, and /status is what tells a viewer's browser which mode it is in.
 */
export const adminRoute = new Hono<{ Bindings: Env }>();

function statusFor(env: Env, key: string | undefined) {
  return {
    lock_enabled: isAdminLockEnabled(env),
    authorized: isAuthorized(env, key),
  };
}

/**
 * Whether this deployment is locked, and whether the key the tab is already carrying
 * still works — which is how a reload restores the unlocked state without a re-prompt.
 */
adminRoute.get("/status", (c) => c.json(statusFor(c.env, c.req.header(ADMIN_HEADER))));

adminRoute.post("/unlock", async (c) => {
  const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
  const password = String(body.password ?? "");
  if (!isAuthorized(c.env, password)) {
    return c.json({ ...statusFor(c.env, undefined), detail: "Mật khẩu không đúng." }, 401);
  }
  return c.json(statusFor(c.env, password));
});
