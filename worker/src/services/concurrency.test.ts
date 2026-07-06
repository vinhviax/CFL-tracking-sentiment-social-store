import { describe, expect, test, vi } from "vitest";
import { mapWithConcurrency, parseBoundedInt } from "./concurrency";

describe("concurrency helpers", () => {
  test("runs async work with the configured concurrency cap", async () => {
    let running = 0;
    let maxRunning = 0;
    const release: Array<() => void> = [];

    const work = mapWithConcurrency([1, 2, 3], 2, async (value) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise<void>((resolve) => release.push(resolve));
      running -= 1;
      return value * 10;
    });

    await Promise.resolve();
    expect(maxRunning).toBe(2);
    expect(release).toHaveLength(2);

    release.shift()?.();
    await vi.waitFor(() => expect(release).toHaveLength(2));

    while (release.length) release.shift()?.();

    await expect(work).resolves.toEqual([10, 20, 30]);
    expect(maxRunning).toBe(2);
  });

  test("parses bounded integer configuration safely", () => {
    expect(parseBoundedInt("3", 1, 5, 2)).toBe(3);
    expect(parseBoundedInt("0", 1, 5, 2)).toBe(1);
    expect(parseBoundedInt("20", 1, 5, 2)).toBe(5);
    expect(parseBoundedInt("bad", 1, 5, 2)).toBe(2);
  });
});
