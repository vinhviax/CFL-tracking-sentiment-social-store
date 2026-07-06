// Ported from backend/app/services/sensortower.py — same API contract, fetch() instead of httpx.
import type { Env } from "../types";
import type { IngestRunRow } from "./csvIngest";

const BASE_URL = "https://api.sensortower.com/v1/{os}/review/get_reviews";
const GOOGLE_APPS: Record<string, string> = { VN: "com.vnggames.cfl.crossfirelegends" };
const APPLE_APPS: Record<string, string> = { VN: "6748588650" };

interface RawReview {
  author: string;
  rating: number;
  content: string;
  dateRaw: string;
  store: "gp" | "ios";
  region: string;
}

async function dedupeHash(store: string, region: string, author: string, dateVal: string, content: string): Promise<string> {
  const key = `st|${store}|${region}|${author.trim()}|${dateVal.trim()}|${content.trim()}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function parseReviewDate(value: string): string | null {
  const v = (value || "").trim();
  if (!v) return null;
  const sourceDate = v.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}:\d{2}(?:\.\d+)?))?/);
  if (sourceDate) {
    const time = sourceDate[2] || "00:00:00";
    const iso = new Date(`${sourceDate[1]}T${time}Z`);
    if (!isNaN(iso.getTime())) return iso.toISOString();
  }
  const iso = new Date(v.replace(" ", "T"));
  if (!isNaN(iso.getTime())) return iso.toISOString();
  return null;
}

async function fetchReviews(
  osPlatform: "android" | "ios",
  appId: string,
  region: string,
  startDate: string,
  endDate: string,
  apiKey: string
): Promise<RawReview[]> {
  const all: RawReview[] = [];
  const store = osPlatform === "android" ? "gp" : "ios";
  const url = BASE_URL.replace("{os}", osPlatform);
  let page = 1;
  const limit = 200;

  while (true) {
    const params = new URLSearchParams({
      auth_token: apiKey, app_id: appId, country: region,
      start_date: startDate, end_date: endDate,
      limit: String(limit), page: String(page),
    });
    const res = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(20000) });
    if (res.status === 401) throw Object.assign(new Error("401 Unauthorized: Sensor Tower API key không hợp lệ."), { permission: true });
    if (res.status === 403) throw Object.assign(new Error("403 Forbidden: Tài khoản không có quyền truy cập Review API."), { permission: true });
    if (!res.ok) break;

    const data: any = await res.json();
    let reviewsList: any[] = [];
    if (Array.isArray(data)) reviewsList = data;
    else if (data && typeof data === "object") {
      reviewsList = data.feedback || data.reviews || data.data || [];
      if (!Array.isArray(reviewsList)) {
        reviewsList = Object.values(data).find((v) => Array.isArray(v)) as any[] || [];
      }
    }
    if (!reviewsList.length) break;

    for (const r of reviewsList) {
      const body = r.body ?? r.content ?? r.text ?? r.review ?? "";
      const title = r.title ?? "";
      const content = title && title !== body ? `${title} - ${body}` : body;
      const author = r.username ?? r.author ?? r.reviewer ?? r.nickname ?? "User";
      let rating = Number(r.rating ?? r.star_rating ?? r.score ?? 3);
      if (isNaN(rating)) rating = 3;
      const dateVal = r.date ?? r.updated_at ?? r.created_at ?? r.at ?? "";
      all.push({ author: String(author), rating, content: content || "", dateRaw: String(dateVal), store, region });
    }

    if (reviewsList.length < limit) break;
    page++;
    await new Promise((r) => setTimeout(r, 500));
  }
  return all;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function filterFreshSensorTowerReviews<T extends { hash: string }>(items: T[], existing: Set<string>): T[] {
  const seen = new Set<string>(existing);
  const fresh: T[] = [];
  for (const item of items) {
    if (seen.has(item.hash)) continue;
    seen.add(item.hash);
    fresh.push(item);
  }
  return fresh;
}

export async function ingestSensorTower(
  env: Env, startDate: string, endDate: string, countries?: string[], note?: Record<string, any>
): Promise<IngestRunRow> {
  const db = env.DB;
  const startedAt = new Date().toISOString();
  const runInsert = await db
    .prepare(`INSERT INTO ingest_runs (source_type, started_at, status) VALUES ('store', ?, 'running')`)
    .bind(startedAt)
    .run();
  const runId = runInsert.meta.last_row_id as number;

  const apiKey = env.SENSORTOWER_API_KEY;
  if (!apiKey) {
    const finishedAt = new Date().toISOString();
    const error = "Thiếu SENSORTOWER_API_KEY trong secrets";
    await db.prepare(`UPDATE ingest_runs SET status='failed', error=?, finished_at=? WHERE id=?`)
      .bind(error, finishedAt, runId).run();
    return { id: runId, source_type: "store", status: "failed", started_at: startedAt, finished_at: finishedAt, rows_fetched: 0, rows_new: 0, note: null, error };
  }

  const regions = countries?.length ? countries : Object.keys(GOOGLE_APPS);
  let fetched = 0, newCount = 0, error: string | null = null;

  try {
    for (const region of regions) {
      const targets: ["android" | "ios", string][] = [];
      if (GOOGLE_APPS[region]) targets.push(["android", GOOGLE_APPS[region]]);
      if (APPLE_APPS[region]) targets.push(["ios", APPLE_APPS[region]]);

      for (const [osPlatform, appId] of targets) {
        const reviews = await fetchReviews(osPlatform, appId, region, startDate, endDate, apiKey);
        fetched += reviews.length;

        const withHash = await Promise.all(
          reviews.map(async (r) => ({ r, hash: await dedupeHash(r.store, r.region, r.author, r.dateRaw, r.content) }))
        );
        const existing = new Set<string>();
        for (const c of chunk(withHash, 90)) {
          const placeholders = c.map(() => "?").join(",");
          const res = await db.prepare(`SELECT dedupe_hash FROM comments WHERE dedupe_hash IN (${placeholders})`)
            .bind(...c.map((x) => x.hash)).all<{ dedupe_hash: string }>();
          for (const row of res.results) existing.add(row.dedupe_hash);
        }
        const fresh = filterFreshSensorTowerReviews(withHash, existing);

        for (const c of chunk(fresh, 100)) {
          const stmts = c.map(({ r, hash }) =>
            db.prepare(
              `INSERT INTO comments (source_type, created_at, author_hint, message, rating, country, store, dedupe_hash, ingest_run_id, skipped_analysis)
               VALUES ('store', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(parseReviewDate(r.dateRaw), r.author, r.content, r.rating, r.region, r.store, hash, runId, r.content.trim().length < 2 ? 1 : 0)
          );
          await db.batch(stmts);
          newCount += c.length;
        }
      }
    }
  } catch (e: any) {
    error = e.message || String(e);
  }

  const finishedAt = new Date().toISOString();
  const status = error ? "failed" : "done";
  const noteText = note ? JSON.stringify({ ...note, start_date: startDate, end_date: endDate }) : JSON.stringify({ start_date: startDate, end_date: endDate });
  await db.prepare(`UPDATE ingest_runs SET status=?, rows_fetched=?, rows_new=?, note=?, error=?, finished_at=? WHERE id=?`)
    .bind(status, fetched, newCount, noteText, error, finishedAt, runId).run();

  return { id: runId, source_type: "store", status, started_at: startedAt, finished_at: finishedAt, rows_fetched: fetched, rows_new: newCount, note: noteText, error };
}
