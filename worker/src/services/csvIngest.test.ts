import { describe, expect, test } from "vitest";
import { filterFreshUniqueHashes } from "./csvIngest";

describe("filterFreshUniqueHashes", () => {
  test("drops hashes that already exist in DB and duplicate hashes within the same upload", () => {
    const existing = new Set(["db-existing"]);
    const rows = [
      { hash: "new-a", row: "first" },
      { hash: "db-existing", row: "already stored" },
      { hash: "new-a", row: "duplicate in file" },
      { hash: "new-b", row: "second unique" },
    ];

    expect(filterFreshUniqueHashes(rows, existing)).toEqual([
      { hash: "new-a", row: "first" },
      { hash: "new-b", row: "second unique" },
    ]);
  });
});
