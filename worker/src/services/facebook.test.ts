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
});
