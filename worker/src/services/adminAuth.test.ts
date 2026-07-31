import { describe, expect, test } from "vitest";
import { Hono } from "hono";
import { ADMIN_HEADER, isAdminLockEnabled, isAuthorized, isSafeMethod, requireAdmin } from "./adminAuth";
import type { Env } from "../types";

const locked = { ADMIN_PASSWORD: "mat-khau-that" } as unknown as Env;
const open = {} as unknown as Env;

describe("isSafeMethod", () => {
  test("reads pass, writes do not", () => {
    expect(isSafeMethod("GET")).toBe(true);
    expect(isSafeMethod("head")).toBe(true);
    expect(isSafeMethod("OPTIONS")).toBe(true);
    expect(isSafeMethod("POST")).toBe(false);
    expect(isSafeMethod("PUT")).toBe(false);
    expect(isSafeMethod("PATCH")).toBe(false);
    expect(isSafeMethod("DELETE")).toBe(false);
  });
});

describe("isAdminLockEnabled", () => {
  test("off until a password is set", () => {
    expect(isAdminLockEnabled(open)).toBe(false);
    expect(isAdminLockEnabled({ ADMIN_PASSWORD: "   " } as unknown as Env)).toBe(false);
    expect(isAdminLockEnabled(locked)).toBe(true);
  });
});

describe("isAuthorized", () => {
  test("an unlocked deployment authorises everyone", () => {
    expect(isAuthorized(open, undefined)).toBe(true);
  });

  test("a locked deployment only accepts the exact password", () => {
    expect(isAuthorized(locked, "mat-khau-that")).toBe(true);
    expect(isAuthorized(locked, "mat-khau-tha")).toBe(false);
    expect(isAuthorized(locked, "")).toBe(false);
    expect(isAuthorized(locked, undefined)).toBe(false);
  });
});

describe("requireAdmin", () => {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", requireAdmin);
  app.get("/thing", (c) => c.json({ ok: true }));
  app.delete("/thing", (c) => c.json({ ok: true }));

  test("lets a viewer read a locked deployment", async () => {
    const res = await app.request("/thing", {}, locked);
    expect(res.status).toBe(200);
  });

  test("rejects a write with no key", async () => {
    const res = await app.request("/thing", { method: "DELETE" }, locked);
    expect(res.status).toBe(401);
    expect((await res.json<{ detail: string }>()).detail).toContain("mật khẩu");
  });

  test("rejects a write with the wrong key", async () => {
    const res = await app.request(
      "/thing",
      { method: "DELETE", headers: { [ADMIN_HEADER]: "doan-mo" } },
      locked
    );
    expect(res.status).toBe(401);
  });

  test("allows a write carrying the password", async () => {
    const res = await app.request(
      "/thing",
      { method: "DELETE", headers: { [ADMIN_HEADER]: "mat-khau-that" } },
      locked
    );
    expect(res.status).toBe(200);
  });

  test("allows a write when no password is configured", async () => {
    const res = await app.request("/thing", { method: "DELETE" }, open);
    expect(res.status).toBe(200);
  });
});
