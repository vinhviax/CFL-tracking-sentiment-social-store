import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { exportRoute } from "./export";

interface StubOptions {
  total?: number;
  rows?: any[];
}

function makeEnv(options: StubOptions = {}) {
  const calls: Array<{ sql: string; args: any[] }> = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          args: [] as any[],
          bind(...args: any[]) {
            this.args = args;
            calls.push({ sql, args });
            return this;
          },
          async first() {
            return { total: options.total ?? (options.rows?.length ?? 0) };
          },
          async all() {
            return { results: options.rows ?? [] };
          },
        };
      },
    },
  } as any;
  return { env, calls };
}

const sampleRow = {
  id: 1,
  source_type: "store",
  created_at: "2026-07-05T08:00:00.000Z",
  message: "Game hay nhưng bị lag",
  rating: 3,
  country: "VN",
  store: "gp",
  post_permalink: null,
  topic_main: "lag_fps",
  topics_sub: "[]",
  sentiment: "negative",
  urgency: "medium",
  summary: "Người chơi thấy lag.",
  confidence: 0.9,
};

function readWorkbook(buf: ArrayBuffer) {
  return XLSX.read(new Uint8Array(buf), { type: "array" });
}

describe("exportRoute", () => {
  test("exports a single store sheet with the new columns", async () => {
    const { env, calls } = makeEnv({ rows: [sampleRow] });
    const res = await exportRoute.request("/?sources=store&from=2026-07-01&to=2026-07-15", {}, env);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
    expect(res.headers.get("Content-Disposition")).toContain("CFL_Comments_Store_20260701-20260715.xlsx");

    const rowsQuery = calls.find((call) => call.sql.includes("ORDER BY c.created_at DESC"));
    expect(rowsQuery?.sql).toContain("c.source_type = ?");
    expect(rowsQuery?.args).toContain("store");

    const wb = readWorkbook(await res.arrayBuffer());
    expect(wb.SheetNames).toEqual(["Store"]);
    const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Store, { header: 1 });
    expect(aoa[0]).toEqual(expect.arrayContaining(["Quốc gia", "Chợ ứng dụng", "Link post Facebook"]));
    expect(aoa[1]).toContain("VN");
    expect(aoa[1]).toContain("Google Play");
  });

  test("creates one sheet per selected source", async () => {
    const { env } = makeEnv({ rows: [sampleRow] });
    const res = await exportRoute.request("/?sources=store,fb_page,fb_group_csv&from=2026-07-01&to=2026-07-15", {}, env);
    const wb = readWorkbook(await res.arrayBuffer());
    expect(wb.SheetNames).toEqual(["Store", "Fanpage", "Group"]);
    expect(res.headers.get("Content-Disposition")).toContain("CFL_Comments_All_20260701-20260715.xlsx");
  });

  test("names the file after the selected subset of sources", async () => {
    const { env } = makeEnv({ rows: [] });
    const res = await exportRoute.request("/?sources=fb_page,fb_group_csv&from=2026-07-01&to=2026-07-15", {}, env);
    const wb = readWorkbook(await res.arrayBuffer());
    expect(wb.SheetNames).toEqual(["Fanpage", "Group"]);
    expect(res.headers.get("Content-Disposition")).toContain("CFL_Comments_Fanpage-Group_20260701-20260715.xlsx");
  });

  test("falls back to all sources when none are specified", async () => {
    const { env } = makeEnv({ rows: [] });
    const res = await exportRoute.request("/", {}, env);
    const wb = readWorkbook(await res.arrayBuffer());
    expect(wb.SheetNames).toEqual(["Store", "Fanpage", "Group"]);
  });

  test("still honours the legacy facebook group param", async () => {
    const { env } = makeEnv({ rows: [] });
    const res = await exportRoute.request("/?group=facebook", {}, env);
    const wb = readWorkbook(await res.arrayBuffer());
    expect(wb.SheetNames).toEqual(["Fanpage", "Group"]);
  });

  test("rejects an export that exceeds the row cap", async () => {
    const { env } = makeEnv({ total: 999999 });
    const res = await exportRoute.request("/?sources=store", {}, env);
    expect(res.status).toBe(413);
  });

  test("rejects an invalid subtopic filter", async () => {
    const { env } = makeEnv({ rows: [] });
    const res = await exportRoute.request("/?subtopic=%20", {}, env);
    expect(res.status).toBe(400);
  });
});
