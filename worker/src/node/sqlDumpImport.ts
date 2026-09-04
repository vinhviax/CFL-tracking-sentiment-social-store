// Streams a `wrangler d1 export` dump into libSQL.
//
// The dump is ~310MB, so it cannot be read into memory and split on ";". This walks it
// chunk by chunk, tracking whether it is inside a quoted string, and hands complete
// statements to libSQL in batches.
//
// Written as a splitter plus an importer so the parsing rules are unit-testable: a
// semicolon inside a player's comment, an escaped apostrophe, and a chunk boundary
// landing in the middle of either are all things that would otherwise corrupt the import
// silently and only surface as a broken statement thousands of rows later.

/** Statements that must not run inside a batch (a batch is one transaction). */
const STANDALONE = /^(PRAGMA|BEGIN|COMMIT|END|ROLLBACK|VACUUM)\b/i;

export class SqlStatementSplitter {
  private buffer = "";
  private inString = false;
  /** True when the previous chunk ended on a quote that may be an escaped one. */
  private pendingQuote = false;
  private inLineComment = false;

  push(chunk: string): string[] {
    const statements: string[] = [];
    for (const ch of chunk) {
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (ch === "'") {
          // '' inside a string is one literal apostrophe: stay in the string.
          this.buffer += "''";
          continue;
        }
        // Not an escape, so that quote closed the string. Emit it, then handle `ch`
        // below as ordinary text outside the string.
        this.buffer += "'";
        this.inString = false;
      }

      if (this.inLineComment) {
        if (ch === "\n") this.inLineComment = false;
        continue;
      }

      if (this.inString) {
        if (ch === "'") {
          // Might close the string, or might be the first half of an escape. Only the
          // next character says which, and it can live in the next chunk.
          this.pendingQuote = true;
          continue;
        }
        this.buffer += ch;
        continue;
      }

      if (ch === "'") {
        this.inString = true;
        this.buffer += "'";
        continue;
      }
      if (ch === "-" && this.buffer.endsWith("-")) {
        // A comment, not part of a value: "--" only starts one outside a string.
        this.buffer = this.buffer.slice(0, -1);
        this.inLineComment = true;
        continue;
      }
      if (ch === ";") {
        const statement = this.buffer.trim();
        if (statement) statements.push(statement);
        this.buffer = "";
        continue;
      }
      this.buffer += ch;
    }
    return statements;
  }

  /** Flush a final statement that the dump left without a trailing semicolon. */
  end(): string[] {
    if (this.pendingQuote) {
      // The dump ended on the quote that closes its last string.
      this.buffer += "'";
      this.pendingQuote = false;
      this.inString = false;
    }
    const statement = this.buffer.trim();
    this.buffer = "";
    return statement ? [statement] : [];
  }
}

export interface ImportClient {
  execute(stmt: string | { sql: string; args: unknown[] }): Promise<{ rows: unknown[] }>;
  batch(stmts: { sql: string; args: unknown[] }[]): Promise<unknown>;
}

export interface ImportResult {
  statements: number;
  batches: number;
  pragmas: number;
}

/**
 * Apply a dump to a database.
 *
 * `onProgress` exists because this takes minutes on the real dump and a silent process
 * is indistinguishable from a stuck one.
 */
export async function importSqlDump(
  client: ImportClient,
  chunks: AsyncIterable<string> | Iterable<string>,
  options: {
    batchSize?: number;
    onProgress?: (statements: number) => void;
    /** Set false only to import a fragment on purpose, knowing it dangles. */
    checkForeignKeys?: boolean;
  } = {}
): Promise<ImportResult> {
  const batchSize = options.batchSize ?? 500;
  const checkForeignKeys = options.checkForeignKeys ?? true;
  const splitter = new SqlStatementSplitter();
  const result: ImportResult = { statements: 0, batches: 0, pragmas: 0 };
  let pending: string[] = [];

  const flush = async () => {
    if (!pending.length) return;
    const batch = pending;
    pending = [];
    try {
      await client.batch(batch.map((sql) => ({ sql, args: [] })));
    } catch (e: any) {
      // A batch of 500 INSERTs that fails says nothing about which one. Replaying them
      // one at a time costs a little time once, and names the statement.
      for (const sql of batch) {
        try {
          await client.execute(sql);
        } catch (inner: any) {
          throw new Error(
            `Failed on statement: ${sql.slice(0, 200)}${sql.length > 200 ? "…" : ""} — ${
              inner?.message || inner
            }`
          );
        }
      }
      throw new Error(`Batch failed but replayed cleanly, which should not happen: ${e?.message || e}`);
    }
    result.batches += 1;
    options.onProgress?.(result.statements);
  };

  const handle = async (statement: string) => {
    result.statements += 1;
    if (STANDALONE.test(statement)) {
      await flush();
      await client.execute(statement);
      result.pragmas += 1;
      return;
    }
    pending.push(statement);
    if (pending.length >= batchSize) await flush();
  };

  // The dump is a directory of per-table files applied in filename order, so a child
  // table can (and does) land before its parent: `comments` before `posts`. libSQL
  // enforces foreign keys by default, so the replay has to run with them off. wrangler's
  // dump emits `PRAGMA defer_foreign_keys=TRUE` for the same reason, but that only holds
  // for one transaction and this restore is thousands of them.
  await client.execute("PRAGMA foreign_keys=OFF");
  try {
    for await (const chunk of chunks as AsyncIterable<string>) {
      for (const statement of splitter.push(chunk)) await handle(statement);
    }
    for (const statement of splitter.end()) await handle(statement);
    await flush();
  } finally {
    await client.execute("PRAGMA foreign_keys=ON");
  }

  if (checkForeignKeys) await assertNoForeignKeyViolations(client);

  return result;
}

/**
 * Having turned enforcement off for the replay, something has to check afterwards.
 * Otherwise a dump that copied half its rows imports "successfully" and the gap surfaces
 * later as comments with no post — silent data loss is the worst outcome of this move.
 *
 * Separate from importSqlDump because a real restore is one file per table: the parent
 * table may legitimately be missing until a later file lands, so the check belongs at the
 * end of the whole run, not the end of each file (pass `checkForeignKeys: false` then).
 */
export async function assertNoForeignKeyViolations(client: ImportClient): Promise<void> {
  const violations = await client.execute("PRAGMA foreign_key_check");
  if (violations.rows.length) {
    throw new Error(
      `Import left ${violations.rows.length} foreign key violation(s), first: ${JSON.stringify(
        violations.rows[0]
      )}`
    );
  }
}
