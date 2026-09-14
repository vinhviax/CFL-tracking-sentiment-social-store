// One-shot escape hatch for getting a locally-built libSQL file onto a remote Dokploy
// volume when nothing else can: no SSH to the host, and Dokploy's Application volumes
// have no upload UI (checked — only rename/delete on the mount, nothing else).
//
// TEMPORARY. Remove this file and its wiring in nodeServer.ts once the current data
// move is done — see the commit that removes it for the exact revert.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createReplaceDbHandler } from "./dbReplace";

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "ascii");
const ADMIN_KEY = "test-admin-key";

function sqliteBytes(payload = "rest of a real sqlite file"): Buffer {
  return Buffer.concat([SQLITE_HEADER, Buffer.from(payload)]);
}

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cfl-dbreplace-"));
  dbPath = join(dir, "cfl-feedback.db");
  writeFileSync(dbPath, "original database contents");
});

describe("createReplaceDbHandler", () => {
  test("rejects everything when ADMIN_PASSWORD is unset, even the normally fail-open default", async () => {
    // Every other admin route fails OPEN with no password (see adminAuth.ts) so a fresh
    // deploy isn't locked out before `wrangler secret put` runs. Replacing the whole
    // database file is destructive enough that this route inverts that: no password
    // configured means no one can call it, full stop.
    const handler = createReplaceDbHandler({ dbPath, adminPassword: "" });
    const res = await handler(
      new Request("http://x/__node-admin/replace-db", {
        method: "POST",
        headers: { "X-CFL-Admin-Key": "anything" },
        body: sqliteBytes(),
      })
    );
    expect(res!.status).toBe(401);
    expect(readFileSync(dbPath, "utf8")).toBe("original database contents");
  });

  test("rejects a missing or wrong admin key", async () => {
    const handler = createReplaceDbHandler({ dbPath, adminPassword: ADMIN_KEY });

    const noKey = await handler(
      new Request("http://x/__node-admin/replace-db", { method: "POST", body: sqliteBytes() })
    );
    expect(noKey!.status).toBe(401);

    const wrongKey = await handler(
      new Request("http://x/__node-admin/replace-db", {
        method: "POST",
        headers: { "X-CFL-Admin-Key": "nope" },
        body: sqliteBytes(),
      })
    );
    expect(wrongKey!.status).toBe(401);
    expect(readFileSync(dbPath, "utf8")).toBe("original database contents");
  });

  test("rejects a body that is not a SQLite file, leaving the live database untouched", async () => {
    // The one guard standing between "authenticated admin" and "arbitrary bytes become
    // the production database" — this is what keeps the endpoint from being a blind
    // write-anything primitive.
    const handler = createReplaceDbHandler({ dbPath, adminPassword: ADMIN_KEY });
    const res = await handler(
      new Request("http://x/__node-admin/replace-db", {
        method: "POST",
        headers: { "X-CFL-Admin-Key": ADMIN_KEY },
        body: Buffer.from("not a database"),
      })
    );
    expect(res!.status).toBe(400);
    expect(readFileSync(dbPath, "utf8")).toBe("original database contents");
  });

  test("replaces the file atomically when the key matches and the upload is a real SQLite file", async () => {
    const handler = createReplaceDbHandler({ dbPath, adminPassword: ADMIN_KEY });
    const newContent = sqliteBytes("the real imported 98MB database (stand-in for the test)");

    const res = await handler(
      new Request("http://x/__node-admin/replace-db", {
        method: "POST",
        headers: { "X-CFL-Admin-Key": ADMIN_KEY },
        body: newContent,
      })
    );

    expect(res!.status).toBe(200);
    const body: any = await res!.json();
    expect(body.bytes_written).toBe(newContent.length);
    expect(readFileSync(dbPath)).toEqual(newContent);
  });

  test("leaves no temp file behind after a successful replace", async () => {
    const handler = createReplaceDbHandler({ dbPath, adminPassword: ADMIN_KEY });
    await handler(
      new Request("http://x/__node-admin/replace-db", {
        method: "POST",
        headers: { "X-CFL-Admin-Key": ADMIN_KEY },
        body: sqliteBytes(),
      })
    );
    const { readdirSync } = await import("node:fs");
    const leftovers = readdirSync(dir).filter((f) => f !== "cfl-feedback.db");
    expect(leftovers).toEqual([]);
  });

  test("ignores requests to any other path or method, so it cannot shadow the real app", async () => {
    const handler = createReplaceDbHandler({ dbPath, adminPassword: ADMIN_KEY });
    expect(
      await handler(
        new Request("http://x/api/comments", { headers: { "X-CFL-Admin-Key": ADMIN_KEY } })
      )
    ).toBeNull();
    expect(
      await handler(
        new Request("http://x/__node-admin/replace-db", {
          method: "GET",
          headers: { "X-CFL-Admin-Key": ADMIN_KEY },
        })
      )
    ).toBeNull();
  });
});
