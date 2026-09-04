// Makes a libSQL connection look exactly like a Cloudflare D1 binding.
//
// The 133 database calls across 17 files in services/ and routes/ are written against
// D1's `prepare().bind().all()/.first()/.run()` shape plus `DB.batch()` and the
// `meta.changes` / `meta.last_row_id` fields. Reimplementing that shape here is what
// lets the whole app move off Workers without touching a single query — and it keeps
// the existing 320 tests meaningful, since they mock this same interface.
//
// libSQL is the SQLite-compatible engine Dokploy offers as a managed database, so the
// 19 migration files in migrations/ run unchanged too. That is the entire reason this
// adapter targets libSQL rather than Postgres.
//
// Only what the app actually uses is implemented. D1 has more surface (exec, dump,
// withSession); adding unused methods here would be inventing behaviour with no test
// to pin it down.

/** The slice of @libsql/client this adapter needs. Kept structural so tests can fake it. */
export interface LibsqlLike {
  execute(stmt: { sql: string; args: unknown[] }): Promise<LibsqlResult>;
  batch(stmts: { sql: string; args: unknown[] }[]): Promise<LibsqlResult[]>;
}

interface LibsqlResult {
  rows: unknown[];
  columns?: string[];
  rowsAffected?: number;
  lastInsertRowid?: bigint | number;
}

/** D1's result shape for a write. */
export interface D1RunResult {
  meta: { changes: number; last_row_id: number };
}

export interface D1StatementLike {
  bind(...args: unknown[]): D1StatementLike;
  all<T = unknown>(): Promise<{ results: T[] }>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<D1RunResult>;
  /** Read by DB.batch(); not part of D1's public statement API. */
  readonly __sql: string;
  readonly __args: unknown[];
}

export interface D1Like {
  prepare(sql: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<D1RunResult[]>;
}

/**
 * libSQL hands back rows that behave as arrays with named properties attached. Copying
 * them into plain objects matters: the app spreads rows (`{ ...row, ...snapshot }` in
 * routes/runs.ts) and serialises them straight to JSON, both of which would otherwise
 * pick up array indices alongside the column names.
 */
function toPlainRow(row: unknown, columns?: string[]): any {
  if (row == null || typeof row !== "object") return row;
  const source = row as Record<string, unknown>;
  const names = columns?.length ? columns : Object.keys(source).filter((k) => !/^\d+$/.test(k));
  const out: Record<string, unknown> = {};
  for (const name of names) out[name] = source[name];
  return out;
}

/**
 * SQLite has no undefined. D1 coerces it, so code that binds an optional value
 * (`job.run_id ?? null` is written in some places but not all) keeps working here.
 */
function normalizeArgs(args: unknown[]): unknown[] {
  return args.map((arg) => (arg === undefined ? null : arg));
}

function toRunResult(result: LibsqlResult): D1RunResult {
  // lastInsertRowid is a BigInt. Nine call sites do `Number(meta.last_row_id)` or use
  // it as an id directly, and a BigInt leaking through breaks both arithmetic and JSON.
  const lastRowId = result.lastInsertRowid;
  return {
    meta: {
      changes: Number(result.rowsAffected ?? 0),
      last_row_id: lastRowId == null ? 0 : Number(lastRowId),
    },
  };
}

class LibsqlStatement implements D1StatementLike {
  constructor(
    private readonly client: LibsqlLike,
    readonly __sql: string,
    readonly __args: unknown[] = []
  ) {}

  /**
   * Returns a new statement rather than mutating this one. services/ builds statements
   * inside loops and reuses the prepared object, so shared mutable args would send the
   * previous iteration's parameters.
   */
  bind(...args: unknown[]): D1StatementLike {
    return new LibsqlStatement(this.client, this.__sql, normalizeArgs(args));
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    const res = await this.client.execute({ sql: this.__sql, args: this.__args });
    return { results: (res.rows || []).map((row) => toPlainRow(row, res.columns)) as T[] };
  }

  async first<T = unknown>(): Promise<T | null> {
    const res = await this.client.execute({ sql: this.__sql, args: this.__args });
    const row = (res.rows || [])[0];
    return row === undefined ? null : (toPlainRow(row, res.columns) as T);
  }

  async run(): Promise<D1RunResult> {
    return toRunResult(await this.client.execute({ sql: this.__sql, args: this.__args }));
  }
}

/**
 * Wrap a libSQL client so it can be handed to the app as `env.DB`.
 *
 * `batch` maps onto libSQL's own batch, which runs the statements in one round trip and
 * in order — the property csvIngest relies on when it inserts posts and then reads each
 * result's last_row_id to link comments to them.
 */
export function createLibsqlD1(client: LibsqlLike): D1Like {
  return {
    prepare(sql: string) {
      return new LibsqlStatement(client, sql);
    },
    async batch(statements: D1StatementLike[]): Promise<D1RunResult[]> {
      if (!statements.length) return [];
      const results = await client.batch(
        statements.map((stmt) => ({ sql: stmt.__sql, args: stmt.__args }))
      );
      return results.map(toRunResult);
    },
  };
}
