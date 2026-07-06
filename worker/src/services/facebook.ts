// Ported from backend/app/services/facebook.py — same API contract, fetch() instead of httpx.
//
// D1/Workers subrequest budget note: Workers cap subrequests per invocation
// (50 on Free, 10,000 on Paid - see Cloudflare Workers limits). Both fetch()
// calls and D1 operations count against this. Comments are collected across
// ALL posts first, then deduped/inserted via chunked batch operations (mirrors
// csvIngest.ts / sensortower.ts) instead of one D1 round-trip per comment.
// Comment pagination per post is also capped to bound fetch() calls.
import type { Env } from "../types";
import type { IngestRunRow } from "./csvIngest";

const GRAPH_VERSION = "v19.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
// Conservative defaults to fit Cloudflare Workers Free plan's 50-subrequest-per-
// invocation budget (fetch() + D1 calls share this budget). With postLimit=10 and
// 2 pages/post, worst case is ~21 fetch() calls + a handful of batched D1 calls.
// On Workers Paid (10,000 subrequests/invocation, $5/mo) these can be raised a lot
// to pull more posts/history per run - see README.
const MAX_COMMENT_PAGES_PER_POST = 2; // 2 x 100 = up to 200 comments/post/run

async function dedupeHash(source: string, externalId: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`fb|${source}|${externalId}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseFbDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function graphGet(url: string, params: Record<string, string>): Promise<any> {
  const full = params && Object.keys(params).length ? `${url}?${new URLSearchParams(params)}` : url;
  const res = await fetch(full, { signal: AbortSignal.timeout(20000) });
  const data: any = await res.json();
  if (!res.ok || data.error) {
    const err = data.error || {};
    if (err.code === 190) {
      throw Object.assign(new Error(`Facebook Access Token đã hết hạn hoặc không hợp lệ: ${err.message}`), { permission: true });
    }
    throw new Error(`Facebook Graph API lỗi (code=${err.code}): ${err.message || (await res.text().catch(() => ""))}`);
  }
  return data;
}

async function fetchPosts(pageId: string, token: string, since?: string, until?: string, limit = 25): Promise<any[]> {
  // `limit` is Graph API's PAGE size, not a total cap — `paging.next` keeps
  // going through the page's entire post history regardless of it. Stop as
  // soon as we have `limit` posts total, or this can burn through Workers'
  // per-invocation subrequest budget on a page with a long post history.
  const params: Record<string, string> = {
    access_token: token, fields: "id,message,created_time,permalink_url", limit: String(limit),
  };
  if (since) params.since = since;
  if (until) params.until = until;

  const posts: any[] = [];
  let nextUrl: string | null = `${GRAPH_BASE}/${pageId}/posts`;
  let nextParams: Record<string, string> = params;
  while (nextUrl && posts.length < limit) {
    const data = await graphGet(nextUrl, nextParams);
    posts.push(...(data.data || []));
    nextUrl = data.paging?.next || null;
    nextParams = {};
    if (!data.data?.length) break;
  }
  return posts.slice(0, limit);
}

async function fetchComments(postId: string, token: string, limit = 100): Promise<any[]> {
  const params: Record<string, string> = {
    access_token: token, fields: "id,message,created_time,from,like_count", filter: "stream", limit: String(limit),
  };
  const comments: any[] = [];
  let nextUrl: string | null = `${GRAPH_BASE}/${postId}/comments`;
  let nextParams: Record<string, string> = params;
  let pages = 0;
  while (nextUrl && pages < MAX_COMMENT_PAGES_PER_POST) {
    const data = await graphGet(nextUrl, nextParams);
    comments.push(...(data.data || []));
    nextUrl = data.paging?.next || null;
    nextParams = {};
    pages++;
    if (!data.data?.length) break;
  }
  return comments;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function ingestFacebook(
  env: Env, since?: string, until?: string, postLimit = 50, note?: Record<string, any>
): Promise<IngestRunRow> {
  const db = env.DB;
  const startedAt = new Date().toISOString();
  const noteText = note
    ? JSON.stringify(note)
    : (since || until ? JSON.stringify({ start_date: since || null, end_date: until || null, post_limit: postLimit }) : null);
  const runInsert = await db
    .prepare(`INSERT INTO ingest_runs (source_type, started_at, status, note) VALUES ('fb_page', ?, 'running', ?)`)
    .bind(startedAt, noteText).run();
  const runId = runInsert.meta.last_row_id as number;

  const pageId = env.FB_PAGE_ID;
  const token = env.FB_ACCESS_TOKEN;
  if (!pageId || !token) {
    const finishedAt = new Date().toISOString();
    const error = "Thiếu FB_PAGE_ID hoặc FB_ACCESS_TOKEN trong secrets";
    await db.prepare(`UPDATE ingest_runs SET status='failed', error=?, finished_at=? WHERE id=?`)
      .bind(error, finishedAt, runId).run();
    return { id: runId, source_type: "fb_page", status: "failed", started_at: startedAt, finished_at: finishedAt, rows_fetched: 0, rows_new: 0, note: noteText, error };
  }

  let fetched = 0, newCount = 0, error: string | null = null;
  try {
    const posts = await fetchPosts(pageId, token, since, until, postLimit);

    // Resolve posts: one batched lookup for existing rows, one batched insert for new ones.
    const postExternalIds = posts.map((p) => p.id);
    const postIdByExternal = new Map<string, number>();
    for (const idsChunk of chunk(postExternalIds, 90)) {
      const placeholders = idsChunk.map(() => "?").join(",");
      const res = await db
        .prepare(`SELECT id, external_id FROM posts WHERE source_type='fb_page' AND external_id IN (${placeholders})`)
        .bind(...idsChunk).all<{ id: number; external_id: string }>();
      for (const r of res.results) postIdByExternal.set(r.external_id, r.id);
    }
    const newPosts = posts.filter((p) => !postIdByExternal.has(p.id));
    for (const c of chunk(newPosts, 50)) {
      const stmts = c.map((p) =>
        db.prepare(
          `INSERT INTO posts (source_type, external_id, published_at, message, permalink) VALUES ('fb_page', ?, ?, ?, ?)`
        ).bind(p.id, parseFbDate(p.created_time), p.message || "", p.permalink_url || null)
      );
      const results = await db.batch(stmts);
      results.forEach((r, idx) => postIdByExternal.set(c[idx].id, r.meta.last_row_id as number));
    }

    // Fetch all comments across all posts before touching D1 again.
    const allComments: { postId: number; cm: any; hash: string }[] = [];
    for (const p of posts) {
      const comments = await fetchComments(p.id, token);
      fetched += comments.length;
      const postId = postIdByExternal.get(p.id)!;
      for (const cm of comments) {
        allComments.push({ postId, cm, hash: await dedupeHash("fb_page", cm.id) });
      }
    }

    // One batched dedupe check instead of a SELECT per comment.
    const existing = new Set<string>();
    for (const c of chunk(allComments, 90)) {
      const placeholders = c.map(() => "?").join(",");
      const res = await db
        .prepare(`SELECT dedupe_hash FROM comments WHERE dedupe_hash IN (${placeholders})`)
        .bind(...c.map((x) => x.hash)).all<{ dedupe_hash: string }>();
      for (const row of res.results) existing.add(row.dedupe_hash);
    }
    const fresh = allComments.filter((x) => !existing.has(x.hash));

    for (const c of chunk(fresh, 90)) {
      const stmts = c.map(({ postId, cm, hash }) => {
        const msg = cm.message || "";
        return db.prepare(
          `INSERT INTO comments (post_id, source_type, external_id, created_at, author_hint, message, dedupe_hash, ingest_run_id, skipped_analysis)
           VALUES (?, 'fb_page', ?, ?, ?, ?, ?, ?, ?)`
        ).bind(postId, cm.id, parseFbDate(cm.created_time), cm.from?.name || null, msg, hash, runId, msg.trim().length < 2 ? 1 : 0);
      });
      await db.batch(stmts);
      newCount += c.length;
    }
  } catch (e: any) {
    error = e.message || String(e);
  }

  const finishedAt = new Date().toISOString();
  const status = error ? "failed" : "done";
  await db.prepare(`UPDATE ingest_runs SET status=?, rows_fetched=?, rows_new=?, note=?, error=?, finished_at=? WHERE id=?`)
    .bind(status, fetched, newCount, noteText, error, finishedAt, runId).run();

  return { id: runId, source_type: "fb_page", status, started_at: startedAt, finished_at: finishedAt, rows_fetched: fetched, rows_new: newCount, note: noteText, error };
}
