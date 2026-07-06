import type { Env } from "../types";

export const SENSOR_TOWER_CURSOR_KEY = "sensortower_store";

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function dateOnlyFromBangkokTime(date: Date): string {
  return new Date(date.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day) + days * DAY_MS;
  return new Date(utc).toISOString().slice(0, 10);
}

export function getYesterdayBangkokDate(now = new Date()): string {
  return addDays(dateOnlyFromBangkokTime(now), -1);
}

export function buildSensorTowerCatchupDates(cursorDate: string, now = new Date()): string[] {
  const endDate = getYesterdayBangkokDate(now);
  const dates: string[] = [];
  for (let d = addDays(cursorDate, 1); d <= endDate; d = addDays(d, 1)) {
    dates.push(d);
  }
  return dates;
}

export async function getStoredSensorTowerCursor(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(`SELECT cursor_date FROM ingest_cursors WHERE key = ?`)
    .bind(SENSOR_TOWER_CURSOR_KEY)
    .first<{ cursor_date: string }>();
  return row?.cursor_date ?? null;
}

export async function seedSensorTowerCursor(env: Env, now = new Date()): Promise<string> {
  const existing = await getStoredSensorTowerCursor(env);
  if (existing) return existing;

  const latest = await env.DB.prepare(
    `SELECT MAX(date(created_at)) as latest_date
     FROM comments
     WHERE source_type = 'store' AND created_at IS NOT NULL`
  ).first<{ latest_date: string | null }>();

  const cursorDate = latest?.latest_date || getYesterdayBangkokDate(now);
  await upsertSensorTowerCursor(env, cursorDate, null);
  return cursorDate;
}

export async function upsertSensorTowerCursor(env: Env, cursorDate: string, lastRunId: number | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ingest_cursors (key, cursor_date, updated_at, last_run_id)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       cursor_date = excluded.cursor_date,
       updated_at = excluded.updated_at,
       last_run_id = excluded.last_run_id`
  ).bind(SENSOR_TOWER_CURSOR_KEY, cursorDate, new Date().toISOString(), lastRunId).run();
}
