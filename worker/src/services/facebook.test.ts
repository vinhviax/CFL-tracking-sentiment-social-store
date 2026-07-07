import { afterEach, describe, expect, test, vi } from "vitest";
import { ingestFacebook } from "./facebook";

function makeDb() {
  let nextId = 100;
  const db = {
    prepare(sql: string) {
      return {
        sql,
        params: [] as unknown[],
        bind(...params: unknown[]) {
          this.params = params;
          return this;
        },
        async run() {
          return { meta: { last_row_id: nextId++ } };
        },
        async all() {
          return { results: [] };
        },
      };
    },
    async batch(stmts: Array<{ sql: string }>) {
      return stmts.map(() => ({ meta: { last_row_id: nextId++ } }));
    },
  };
  return db;
}

describe("ingestFacebook", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("paginates comments for each Fanpage post instead of capping at nested comments", async () => {
    const posts = Array.from({ length: 2 }, (_, index) => ({
      id: `post_${index}`,
      message: `post ${index}`,
      created_time: "2026-07-06T01:00:00+0000",
      permalink_url: `https://facebook.com/post_${index}`,
    }));
    const fetchMock = vi.fn(async (url: string) => {
      const full = String(url);
      if (full.includes("/page/posts")) return new Response(JSON.stringify({ data: posts }), { status: 200 });
      if (full.includes("/post_0/comments") && full.includes("after=page2")) {
        return new Response(JSON.stringify({
          data: [{ id: "comment_0_2", message: "comment 0 page 2", created_time: "2026-07-06T03:00:00+0000" }],
        }), { status: 200 });
      }
      if (full.includes("/post_0/comments")) {
        return new Response(JSON.stringify({
          data: [{ id: "comment_0_1", message: "comment 0 page 1", created_time: "2026-07-06T02:00:00+0000" }],
          paging: { next: `${full}&after=page2` },
        }), { status: 200 });
      }
      if (full.includes("/post_1/comments")) {
        return new Response(JSON.stringify({
          data: [{ id: "comment_1_1", message: "comment 1 page 1", created_time: "2026-07-06T02:30:00+0000" }],
        }), { status: 200 });
      }
      throw new Error(`unexpected Graph URL ${full}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const run = await ingestFacebook(
      { DB: makeDb(), FB_PAGE_ID: "page", FB_ACCESS_TOKEN: "token" } as any,
      "2026-06-29",
      "2026-07-07",
      50
    );

    expect(run.status).toBe("done");
    expect(run.rows_fetched).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/page/posts");
    expect(fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("/comments"))).toHaveLength(3);
  });

  test("filters paginated comments to the requested Fanpage comment date range", async () => {
    const post = {
      id: "post_1",
      message: "post 1",
      created_time: "2026-07-05T01:00:00+0000",
      permalink_url: "https://facebook.com/post_1",
    };
    const fetchMock = vi.fn(async (url: string) => {
      const full = String(url);
      if (full.includes("/page/posts")) return new Response(JSON.stringify({ data: [post] }), { status: 200 });
      if (full.includes("/post_1/comments")) {
        return new Response(JSON.stringify({
          data: [
          {
            id: "comment_in_range",
            message: "comment in range",
            created_time: "2026-07-05T15:30:00+0000",
          },
          {
            id: "comment_out_of_range",
            message: "comment out of range",
            created_time: "2026-07-05T17:10:00+0000",
          },
          ],
        }), { status: 200 });
      }
      throw new Error(`unexpected Graph URL ${full}`);
    });
    const insertedComments: any[][] = [];
    const db = {
      prepare(sql: string) {
        return {
          sql,
          params: [] as unknown[],
          bind(...params: unknown[]) {
            this.params = params;
            return this;
          },
          async run() {
            return { meta: { last_row_id: 100 } };
          },
          async all() {
            return { results: [] };
          },
        };
      },
      async batch(stmts: Array<{ sql: string; params: any[] }>) {
        for (const stmt of stmts) {
          if (stmt.sql.includes("INSERT INTO comments")) insertedComments.push(stmt.params);
        }
        return stmts.map((_stmt, index) => ({ meta: { last_row_id: 200 + index } }));
      },
    };
    vi.stubGlobal("fetch", fetchMock);

    const run = await ingestFacebook(
      { DB: db, FB_PAGE_ID: "page", FB_ACCESS_TOKEN: "token" } as any,
      "2026-06-29",
      "2026-07-06",
      50,
      { start_date: "2026-06-29", end_date: "2026-07-05" },
      { startDate: "2026-06-29", endDate: "2026-07-05" }
    );

    expect(run.rows_fetched).toBe(1);
    expect(run.rows_new).toBe(1);
    expect(insertedComments).toHaveLength(1);
    expect(insertedComments[0][1]).toBe("comment_in_range");
  });
});
