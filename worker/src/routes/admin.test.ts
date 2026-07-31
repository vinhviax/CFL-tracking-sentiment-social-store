import { describe, expect, test } from "vitest";
import { ADMIN_HEADER } from "../services/adminAuth";
import { adminRoute } from "./admin";
import type { Env } from "../types";

const locked = { ADMIN_PASSWORD: "mo-khoa-123" } as unknown as Env;
const open = {} as unknown as Env;

const json = (res: Response) => res.json<{ lock_enabled: boolean; authorized: boolean; detail?: string }>();

describe("GET /status", () => {
  test("an open deployment reports no lock and full rights", async () => {
    const body = await json(await adminRoute.request("/status", {}, open));
    expect(body).toEqual({ lock_enabled: false, authorized: true });
  });

  test("a locked deployment reports read-only for a tab with no key", async () => {
    const body = await json(await adminRoute.request("/status", {}, locked));
    expect(body).toEqual({ lock_enabled: true, authorized: false });
  });

  test("a tab still carrying the password stays unlocked across a reload", async () => {
    const res = await adminRoute.request("/status", { headers: { [ADMIN_HEADER]: "mo-khoa-123" } }, locked);
    expect(await json(res)).toEqual({ lock_enabled: true, authorized: true });
  });
});

describe("POST /unlock", () => {
  const post = (env: Env, body: unknown) =>
    adminRoute.request(
      "/unlock",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      env
    );

  test("the right password unlocks", async () => {
    const res = await post(locked, { password: "mo-khoa-123" });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ lock_enabled: true, authorized: true });
  });

  test("a wrong password is rejected and never reported as authorized", async () => {
    const res = await post(locked, { password: "sai" });
    expect(res.status).toBe(401);
    const body = await json(res);
    expect(body.authorized).toBe(false);
    expect(body.detail).toContain("không đúng");
  });

  test("a malformed body is a rejection, not a crash", async () => {
    const res = await adminRoute.request("/unlock", { method: "POST", body: "not json" }, locked);
    expect(res.status).toBe(401);
  });
});
