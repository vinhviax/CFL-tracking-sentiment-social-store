import type { Env } from "../types";

export const SENSOR_TOWER_CURSOR_KEY = "sensortower_store";
export const FACEBOOK_CURSOR_KEY = "facebook_page";

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnlyFromBangkokTime(date: Date): string {
  return new Date(date.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day) + days * DAY_MS;
  return new Date(utc).toISOString().slice(0, 10);
}

export function getTodayBangkokDate(now = new Date()): string {
  return dateOnlyFromBangkokTime(now);
}

export function getYesterdayBangkokDate(now = new Date()): string {
  return addDays(dateOnlyFromBangkokTime(now), -1);
}

export function buildCursorCatchupRange(cursorDate: string, now = new Date()): { startDate: string; endDate: string } | null {
  const endDate = getTodayBangkokDate(now);
  if (cursorDate >= endDate) return null;
  return { startDate: cursorDate, endDate };
}

export function buildSensorTowerCatchupDates(cursorDate: string, now = new Date()): string[] {
  const endDate = getTodayBangkokDate(now);
  const dates: string[] = [];
  for (let d = cursorDate; d < endDate; d = addDays(d, 1)) {
    dates.push(d);
  }
  return dates;
}

export async function getStoredSourceCursor(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT cursor_date FROM ingest_cursors WHERE key = ?`)
    .bind(key)
    .first<{ cursor_date: string }>();
  return row?.cursor_date ?? null;
}

export async function getStoredSensorTowerCursor(env: Env): Promise<string | null> {
  return getStoredSourceCursor(env, SENSOR_TOWER_CURSOR_KEY);
}

export async function seedSourceCursor(
  env: Env,
  opts: { key: string; sourceType: string },
  now = new Date()
): Promise<string> {
  const existing = await getStoredSourceCursor(env, opts.key);
  if (existing) return existing;

  const latest = await env.DB.prepare(
    `SELECT MAX(date(created_at)) as latest_date
     FROM comments
     WHERE source_type = ? AND created_at IS NOT NULL`
  ).bind(opts.sourceType).first<{ latest_date: string | null }>();

  const cursorDate = latest?.latest_date || getTodayBangkokDate(now);
  await upsertSourceCursor(env, opts.key, cursorDate, null);
  return cursorDate;
}

export async function seedSensorTowerCursor(env: Env, now = new Date()): Promise<string> {
  return seedSourceCursor(env, { key: SENSOR_TOWER_CURSOR_KEY, sourceType: "store" }, now);
}

export async function upsertSourceCursor(env: Env, key: string, cursorDate: string, lastRunId: number | null): Promise<void> {
  const existing = await env.DB.prepare(
    `SELECT cursor_date FROM ingest_cursors WHERE key = ?`
  ).bind(key).first<{ cursor_date: string }>();
  const nextCursor = existing?.cursor_date && existing.cursor_date > cursorDate ? existing.cursor_date : cursorDate;
  await env.DB.prepare(
    `INSERT INTO ingest_cursors (key, cursor_date, updated_at, last_run_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       cursor_date = excluded.cursor_date,
       updated_at = excluded.updated_at,
       last_run_id = excluded.last_run_id`
  ).bind(key, nextCursor, new Date().toISOString(), lastRunId).run();
}

export async function updateSourceCursorFromRun(
  env: Env,
  opts: { key: string; runId: number; requestedEndDate: string }
): Promise<void> {
  await upsertSourceCursor(env, opts.key, opts.requestedEndDate, opts.runId);
}

export async function upsertSensorTowerCursor(env: Env, cursorDate: string, lastRunId: number | null): Promise<void> {
  await upsertSourceCursor(env, SENSOR_TOWER_CURSOR_KEY, cursorDate, lastRunId);
}
