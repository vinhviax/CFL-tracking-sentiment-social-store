import { createClient } from "@libsql/client";
import { describe, expect, test } from "vitest";
import { assertNoForeignKeyViolations, importSqlDump, SqlStatementSplitter } from "./sqlDumpImport";

function splitAll(chunks: string[]): string[] {
  const splitter = new SqlStatementSplitter();
  const out: string[] = [];
  for (const chunk of chunks) out.push(...splitter.push(chunk));
  out.push(...splitter.end());
  return out;
}

/**
 * The dump this has to survive is ~310MB of `wrangler d1 export` output, so it cannot be
 * read into memory and split on ";" — the splitter is fed arbitrary chunks, and a chunk
 * boundary can fall anywhere, including inside a quoted comment written by a player.
 */
describe("SqlStatementSplitter", () => {
  test("splits on statement boundaries and drops the trailing empty piece", () => {
    expect(splitAll(["CREATE TABLE a (id INTEGER);\nINSERT INTO a VALUES(1);\n"])).toEqual([
      "CREATE TABLE a (id INTEGER)",
      "INSERT INTO a VALUES(1)",
    ]);
  });

  test("keeps a semicolon that belongs to a string value", () => {
    // Real comment text: "lag qua; choi khong noi". Splitting here would produce two
    // broken statements and abort the import halfway through.
    expect(splitAll(["INSERT INTO c VALUES('lag qua; choi khong noi');"])).toEqual([
      "INSERT INTO c VALUES('lag qua; choi khong noi')",
    ]);
  });

  test("handles a doubled single quote, which is how SQL escapes an apostrophe", () => {
    expect(splitAll(["INSERT INTO c VALUES('it''s; fine');SELECT 1;"])).toEqual([
      "INSERT INTO c VALUES('it''s; fine')",
      "SELECT 1",
    ]);
  });

  test("survives a chunk boundary falling inside a quoted string", () => {
    expect(splitAll(["INSERT INTO c VALUES('nua dem; ", "khong ngu duoc');"])).toEqual([
      "INSERT INTO c VALUES('nua dem; khong ngu duoc')",
    ]);
  });

  test("survives a chunk boundary falling between the two halves of an escaped quote", () => {
    expect(splitAll(["INSERT INTO c VALUES('a'", "'b');"])).toEqual([
      "INSERT INTO c VALUES('a''b')",
    ]);
  });

  test("ignores comment lines but not a double dash inside a string", () => {
    expect(
      splitAll(["-- exported by wrangler\nINSERT INTO c VALUES('a -- b; c');\n"])
    ).toEqual(["INSERT INTO c VALUES('a -- b; c')"]);
  });

  test("returns a final statement that has no trailing semicolon", () => {
    expect(splitAll(["SELECT 1"])).toEqual(["SELECT 1"]);
  });

  test("keeps multi-byte text intact", () => {
    const vietnamese = "Cập nhật xong vẫn lag; sửa giùm";
    expect(splitAll([`INSERT INTO c VALUES('${vietnamese}');`])).toEqual([
      `INSERT INTO c VALUES('${vietnamese}')`,
    ]);
  });
});

/**
 * Deliberately awkward chunking: 7 characters at a time, so chunk boundaries land inside
 * strings and keywords the way a 64KB read boundary eventually will.
 */
async function importText(text: string, opts?: { batchSize?: number }) {
  const client = createClient({ url: ":memory:" });
  const stream = (async function* () {
    for (let i = 0; i < text.length; i += 7) yield text.slice(i, i + 7);
  })();
  const result = await importSqlDump(client as any, stream, opts);
  return { client, result };
}

describe("importSqlDump", () => {
  test("applies schema and data from a dump, in order", async () => {
    const { client, result } = await importText(
      [
        "PRAGMA defer_foreign_keys=TRUE;",
        "CREATE TABLE comments (id INTEGER PRIMARY KEY, message TEXT);",
        "INSERT INTO comments VALUES(1,'lag qua; tro khong noi');",
        "INSERT INTO comments VALUES(2,'ổn rồi');",
      ].join("\n")
    );
    try {
      expect(result.statements).toBe(4); // the PRAGMA counts too
      // PRAGMA is run on its own, outside the batches — a batch is a transaction, and
      // several PRAGMAs are a no-op or an error inside one.
      expect(result.pragmas).toBe(1);
      const rows = await client.execute("SELECT id, message FROM comments ORDER BY id");
      expect(rows.rows.map((r: any) => r.message)).toEqual(["lag qua; tro khong noi", "ổn rồi"]);
    } finally {
      client.close();
    }
  });

  test("reports which statement failed instead of a bare SQL error", async () => {
    await expect(
      importText("CREATE TABLE a (id INTEGER);\nINSERT INTO nosuchtable VALUES(1);")
    ).rejects.toThrow(/nosuchtable/);
  });

  test("batches instead of sending one statement at a time", async () => {
    const rows = Array.from({ length: 50 }, (_, i) => `INSERT INTO a VALUES(${i});`);
    const { client, result } = await importText(
      ["CREATE TABLE a (id INTEGER);", ...rows].join("\n"),
      { batchSize: 10 }
    );
    try {
      expect(result.statements).toBe(51);
      expect(result.batches).toBe(6); // 51 statements / 10
      const count = await client.execute("SELECT COUNT(*) AS n FROM a");
      expect(Number((count.rows[0] as any).n)).toBe(50);
    } finally {
      client.close();
    }
  });
});

/**
 * Foreign keys, the way a real restore meets them.
 *
 * The dump is a directory of per-table files applied in filename order, so `comments`
 * (which references `posts`) lands before `posts` — alphabetically it has to. libSQL
 * enforces foreign keys by default, so a plain replay fails on the very first comment.
 * wrangler's own dump emits `PRAGMA defer_foreign_keys=TRUE` for this, but that only
 * holds inside one transaction, and a 310MB restore is thousands of them.
 */
describe("importSqlDump and foreign keys", () => {
  const SCHEMA = [
    "CREATE TABLE posts (id INTEGER PRIMARY KEY);",
    "CREATE TABLE comments (id INTEGER PRIMARY KEY, post_id INTEGER REFERENCES posts(id));",
  ].join("\n");

  test("accepts a child row that arrives before its parent", async () => {
    const { client, result } = await importText(
      [SCHEMA, "INSERT INTO comments VALUES(1,7);", "INSERT INTO posts VALUES(7);"].join("\n")
    );
    try {
      expect(result.statements).toBe(4);
      const rows = await client.execute("SELECT post_id FROM comments");
      expect(Number((rows.rows[0] as any).post_id)).toBe(7);
    } finally {
      client.close();
    }
  });

  test("refuses an import that leaves a dangling reference", async () => {
    // Enforcement is off during the replay, so something has to check afterwards or a
    // half-copied dump imports "successfully" and only shows up as missing data later.
    await expect(
      importText([SCHEMA, "INSERT INTO comments VALUES(1,7);"].join("\n"))
    ).rejects.toThrow(/foreign key/i);
  });
  test("a per-file import defers the check to the end of the run", async () => {
    // How the real restore works: one file per table, so the parent table is legitimately
    // missing until a later file lands. Checking after each file would reject a healthy
    // dump; checking only at the end still catches a broken one.
    const client = createClient({ url: ":memory:" });
    try {
      const file = (text: string) =>
        importSqlDump(client as any, [text], { checkForeignKeys: false });
      await file(SCHEMA);
      await file("INSERT INTO comments VALUES(1,7);");
      await expect(assertNoForeignKeyViolations(client as any)).rejects.toThrow(/foreign key/i);

      await file("INSERT INTO posts VALUES(7);");
      await expect(assertNoForeignKeyViolations(client as any)).resolves.toBeUndefined();
    } finally {
      client.close();
    }
  });
});
