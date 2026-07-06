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

  test("uses nested Graph API comments instead of fetching comments once per post", async () => {
    const posts = Array.from({ length: 50 }, (_, index) => ({
      id: `post_${index}`,
      message: `post ${index}`,
      created_time: "2026-07-06T01:00:00+0000",
      permalink_url: `https://facebook.com/post_${index}`,
      comments: {
        data: [{
          id: `comment_${index}`,
          message: `comment ${index}`,
          created_time: "2026-07-06T02:00:00+0000",
          from: { name: "Player" },
        }],
      },
    }));
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/comments")) throw new Error("unexpected per-post comments request");
      return new Response(JSON.stringify({ data: posts }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const run = await ingestFacebook(
      { DB: makeDb(), FB_PAGE_ID: "page", FB_ACCESS_TOKEN: "token" } as any,
      "2026-06-29",
      "2026-07-07",
      50
    );

    expect(run.status).toBe("done");
    expect(run.rows_fetched).toBe(50);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/page/posts");
  });

  test("retries with a smaller nested comment payload when Facebook asks to reduce data", async () => {
    const post = {
      id: "post_1",
      message: "post 1",
      created_time: "2026-07-06T01:00:00+0000",
      permalink_url: "https://facebook.com/post_1",
      comments: {
        data: [{
          id: "comment_1",
          message: "comment 1",
          created_time: "2026-07-06T02:00:00+0000",
        }],
      },
    };
    const fetchMock = vi.fn(async (url: string) => {
      const full = String(url);
      if (full.includes("comments.limit%2825%29")) {
        return new Response(JSON.stringify({
          error: { code: 1, message: "Please reduce the amount of data you're asking for, then retry your request" },
        }), { status: 500 });
      }
      return new Response(JSON.stringify({ data: [post] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const run = await ingestFacebook(
      { DB: makeDb(), FB_PAGE_ID: "page", FB_ACCESS_TOKEN: "token" } as any,
      "2026-06-29",
      "2026-07-07",
      50
    );

    expect(run.status).toBe("done");
    expect(run.rows_fetched).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("comments.limit%2810%29");
  });

  test("filters nested comments to the requested Fanpage comment date range", async () => {
    const post = {
      id: "post_1",
      message: "post 1",
      created_time: "2026-07-05T01:00:00+0000",
      permalink_url: "https://facebook.com/post_1",
      comments: {
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
      },
    };
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
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [post] }), { status: 200 })));

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
