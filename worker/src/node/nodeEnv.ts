// Builds the `Env` the app expects out of a plain Node process environment.
//
// On Workers, `Env` arrived ready-made: wrangler.jsonc "vars" for the tuning knobs, the
// Secrets Store for the keys, and the D1 binding for the database. A container gets
// none of that, so this module is now the single place where those three come together.
// Everything downstream keeps reading `c.env.X` exactly as before.
import { createClient } from "@libsql/client";
import { createLibsqlD1, type D1Like } from "../db/libsqlAdapter";
import type { Env } from "../types";

/**
 * The wrangler.jsonc "vars" values, restated for the container.
 *
 * These are not arbitrary: the batch sizes and concurrency were tuned against real
 * runs (see the comments in wrangler.jsonc), and a missing CLASSIFY_BATCH_SIZE turns
 * into `NaN` batches rather than an error. nodeEnv.test.ts asserts these still match
 * wrangler.jsonc so the two runtimes cannot quietly disagree while both exist.
 */
export const NODE_VAR_DEFAULTS = {
  CLASSIFY_BATCH_SIZE: "20",
  ANALYSIS_BATCH_SIZE: "20",
  TRANSLATION_BATCH_SIZE: "20",
  LLM_BATCH_CONCURRENCY: "2",
  PROCESSING_JOB_MAX_BATCHES: "5",
  PROCESSING_QUEUE_CONCURRENCY: "3",
  // The only LLM endpoint reachable from inside the VNG network. LLM_VIAX_BASE_URL is
  // deliberately absent: defaulting it would advertise a provider whose every call
  // fails from here.
  LLM_VNG_LITE_BASE_URL: "https://lite-aawp.vnggames.net/v1",
} as const;

export type ProcessEnv = Record<string, string | undefined>;

function pick(source: ProcessEnv, name: string): string | undefined {
  const value = source[name];
  return value === undefined || value === "" ? undefined : value;
}

export function buildNodeEnv(source: ProcessEnv, db: D1Like): Env {
  const vars = Object.fromEntries(
    Object.entries(NODE_VAR_DEFAULTS).map(([name, fallback]) => [name, pick(source, name) ?? fallback])
  ) as Record<keyof typeof NODE_VAR_DEFAULTS, string>;

  return {
    // The adapter implements the slice of D1Database the app uses (see libsqlAdapter.ts);
    // the full D1 interface has surface nothing here calls.
    DB: db as unknown as Env["DB"],
    ...vars,
    LLM_VIAX_BASE_URL: pick(source, "LLM_VIAX_BASE_URL"),
    ADMIN_PASSWORD: pick(source, "ADMIN_PASSWORD"),
    SENSORTOWER_API_KEY: pick(source, "SENSORTOWER_API_KEY"),
    FB_PAGE_ID: pick(source, "FB_PAGE_ID"),
    FB_ACCESS_TOKEN: pick(source, "FB_ACCESS_TOKEN"),
    LLM_VIAX_API_KEY: pick(source, "LLM_VIAX_API_KEY"),
    LLM_VNG_LITE_API_KEY: pick(source, "LLM_VNG_LITE_API_KEY"),
  };
}

export const DEFAULT_PORT = 8787;

export function resolvePort(source: ProcessEnv): number {
  const raw = pick(source, "PORT");
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be a valid port number, got "${raw}"`);
  }
  return port;
}

/**
 * Open the libSQL database and hand it back wearing D1's shape.
 *
 * LIBSQL_URL is required on purpose. A default such as `file:./data/app.db` would boot
 * happily against an empty file and answer every request with "no comments yet", which
 * is indistinguishable from having lost the data.
 */
export function createLibsqlDatabase(source: ProcessEnv): { db: D1Like; close: () => void } {
  const url = pick(source, "LIBSQL_URL");
  if (!url) {
    throw new Error(
      "LIBSQL_URL is required (e.g. file:/data/cfl-feedback.db, or http://libsql:8080 for a libSQL server)"
    );
  }
  const client = createClient({ url, authToken: pick(source, "LIBSQL_AUTH_TOKEN") });
  return { db: createLibsqlD1(client as any), close: () => client.close() };
}
