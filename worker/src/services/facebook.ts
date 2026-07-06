// Ported from backend/app/services/facebook.py — same API contract, fetch() instead of httpx.
import type { Env } from "../types";
import type { IngestRunRow } from "./csvIngest";

const GRAPH_VERSION = "v19.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

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
  const params: Record<string, string> = {
    access_token: token, fields: "id,message,created_time,permalink_url", limit: String(limit),
  };
  if (since) params.since = since;
  if (until) params.until = until;

  const posts: any[] = [];
  let nextUrl: string | null = `${GRAPH_BASE}/${pageId}/posts`;
  let nextParams: Record<string, string> = params;
  while (nextUrl) {
    const data = await graphGet(nextUrl, nextParams);
    posts.push(...(data.data || []));
    nextUrl = data.paging?.next || null;
    nextParams = {};
    if (!data.data?.length) break;
  }
  return posts;
}

async function fetchComments(postId: string, token: string, limit = 100): Promise<any[]> {
  const params: Record<string, string> = {
    access_token: token, fields: "id,message,created_time,from,like_count", filter: "stream", limit: String(limit),
  };
  const comments: any[] = [];
  let nextUrl: string | null = `${GRAPH_BASE}/${postId}/comments`;
  let nextParams: Record<string, string> = params;
  while (nextUrl) {
    const data = await graphGet(nextUrl, nextParams);
    comments.push(...(data.data || []));
    nextUrl = data.paging?.next || null;
    nextParams = {};
    if (!data.data?.length) break;
  }
  return comments;
}

export async function ingestFacebook(
  env: Env, since?: string, until?: string, postLimit = 25
): Promise<IngestRunRow> {
  const db = env.DB;
  const startedAt = new Date().toISOString();
  const runInsert = await db
    .prepare(`INSERT INTO ingest_runs (source_type, started_at, status) VALUES ('fb_page', ?, 'running')`)
    .bind(startedAt).run();
  const runId = runInsert.meta.last_row_id as number;

  const pageId = env.FB_PAGE_ID;
  const token = env.FB_ACCESS_TOKEN;
  if (!pageId || !token) {
    const finishedAt = new Date().toISOString();
    const error = "Thiếu FB_PAGE_ID hoặc FB_ACCESS_TOKEN trong secrets";
    await db.prepare(`UPDATE ingest_runs SET status='failed', error=?, finished_at=? WHERE id=?`)
      .bind(error, finishedAt, runId).run();
    return { id: runId, source_type: "fb_page", status: "failed", started_at: startedAt, finished_at: finishedAt, rows_fetched: 0, rows_new: 0, note: null, error };
  }

  let fetched = 0, newCount = 0, error: string | null = null;
  try {
    const posts = await fetchPosts(pageId, token, since, until, postLimit);
    for (const p of posts) {
      let post = await db.prepare(`SELECT id FROM posts WHERE source_type='fb_page' AND external_id=?`)
        .bind(p.id).first<{ id: number }>();
      let postId: number;
      if (!post) {
        const ins = await db.prepare(
          `INSERT INTO posts (source_type, external_id, published_at, message, permalink) VALUES ('fb_page', ?, ?, ?, ?)`
        ).bind(p.id, parseFbDate(p.created_time), p.message || "", p.permalink_url || null).run();
        postId = ins.meta.last_row_id as number;
      } else {
        postId = post.id;
      }

      const comments = await fetchComments(p.id, token);
      fetched += comments.length;

      for (const cm of comments) {
        const hash = await dedupeHash("fb_page", cm.id);
        const exists = await db.prepare(`SELECT id FROM comments WHERE dedupe_hash=?`).bind(hash).first();
        if (exists) continue;
        const msg = cm.message || "";
        await db.prepare(
          `INSERT INTO comments (post_id, source_type, external_id, created_at, author_hint, message, dedupe_hash, ingest_run_id, skipped_analysis)
           VALUES (?, 'fb_page', ?, ?, ?, ?, ?, ?, ?)`
        ).bind(postId, cm.id, parseFbDate(cm.created_time), cm.from?.name || null, msg, hash, runId, msg.trim().length < 2 ? 1 : 0).run();
        newCount++;
      }
    }
  } catch (e: any) {
    error = e.message || String(e);
  }

  const finishedAt = new Date().toISOString();
  const status = error ? "failed" : "done";
  await db.prepare(`UPDATE ingest_runs SET status=?, rows_fetched=?, rows_new=?, error=?, finished_at=? WHERE id=?`)
    .bind(status, fetched, newCount, error, finishedAt, runId).run();

  return { id: runId, source_type: "fb_page", status, started_at: startedAt, finished_at: finishedAt, rows_fetched: fetched, rows_new: newCount, note: null, error };
}
