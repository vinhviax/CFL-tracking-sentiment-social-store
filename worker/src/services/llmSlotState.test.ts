import { describe, expect, test } from "vitest";
import {
  claimSlotAttempt,
  classifyLlmError,
  completeJsonForSlot,
  getSlotState,
  recordSlotFailure,
  recordSlotSuccess,
  resetAllSlotsForNewDay,
  resetSlotEscalation,
} from "./llmSlotState";

const CONSECUTIVE_FAILURES_TO_ESCALATE = 3;

/**
 * Fake D1 that re-implements the real UPDATE/SELECT semantics of llm_slot_state
 * in JS (mirroring processingQueue.test.ts's fakeQueueDb), so these tests exercise
 * the actual state-transition logic rather than just recording calls.
 */
function fakeSlotDb(seed: Record<string, any> = {}) {
  const rows = new Map<string, any>(
    Object.entries(seed).map(([slot, v]) => [
      slot,
      {
        tier: "primary",
        consecutive_failures: 0,
        last_failure_at: null,
        last_success_at: null,
        last_error: null,
        last_error_category: null,
        exhausted_date: null,
        updated_at: "",
        ...v,
      },
    ])
  );
  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async first() {
              if (sql.includes("INSERT OR IGNORE")) return null;
              if (sql.startsWith("SELECT")) {
                const slot = args[args.length - 1];
                return rows.get(slot) || null;
              }
              return null;
            },
            async run() {
              if (sql.includes("INSERT OR IGNORE")) {
                const [slot, updated_at] = args;
                if (!rows.has(slot)) {
                  rows.set(slot, {
                    tier: "primary", consecutive_failures: 0, last_failure_at: null,
                    last_success_at: null, last_error: null, last_error_category: null,
                    exhausted_date: null, updated_at,
                  });
                }
                return {};
              }
              if (!sql.startsWith("UPDATE")) return {};

              if (sql.includes("tier = CASE")) {
                // recordSlotFailure
                const [threshold1, threshold2, threshold3, threshold4, today, now, error, category, updatedAt, slot] = args;
                const row = rows.get(slot);
                if (!row) return {};
                const next = row.consecutive_failures + 1;
                if (row.tier === "primary" && next >= threshold1) {
                  row.tier = "secondary"; row.consecutive_failures = 0;
                } else if (row.tier === "secondary" && next >= threshold2) {
                  row.tier = "exhausted"; row.consecutive_failures = 0; row.exhausted_date = today;
                } else {
                  row.consecutive_failures = next;
                }
                row.last_failure_at = now; row.last_error = error;
                row.last_error_category = category; row.updated_at = updatedAt;
                return {};
              }

              if (sql.includes("WHERE slot = ?") && sql.includes("consecutive_failures = 0")) {
                // recordSlotSuccess or resetSlotEscalation
                const isReset = sql.includes("tier = 'primary'");
                const slot = args[args.length - 1];
                const row = rows.get(slot);
                if (!row) return {};
                row.consecutive_failures = 0;
                row.last_failure_at = null;
                row.last_error = null;
                row.last_error_category = null;
                if (isReset) { row.tier = "primary"; row.exhausted_date = null; }
                else { row.last_success_at = args[0]; }
                row.updated_at = args[args.length - 2];
                return {};
              }

              if (sql.includes("tier = 'primary'") && !sql.includes("WHERE slot")) {
                // resetAllSlotsForNewDay — every row
                for (const row of rows.values()) {
                  row.tier = "primary"; row.consecutive_failures = 0; row.exhausted_date = null;
                  row.last_failure_at = null; row.last_error = null; row.last_error_category = null;
                  row.updated_at = args[0];
                }
                return {};
              }

              return {};
            },
          };
        },
      };
    },
  };
  return { env: { DB } as any, rows };
}

describe("claimSlotAttempt", () => {
  test("a healthy slot may be attempted", async () => {
    const { env } = fakeSlotDb({ reasoning: { tier: "primary" } });
    expect(await claimSlotAttempt(env, "reasoning")).toEqual({ tier: "primary" });
  });

  test("exhausted today blocks the attempt", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { env } = fakeSlotDb({ reasoning: { tier: "exhausted", exhausted_date: today } });
    expect(await claimSlotAttempt(env, "reasoning")).toBeNull();
  });

  test("exhausted on a past day (before today's reset ran) is NOT auto-cleared by claim — only the daily cron resets it", async () => {
    const { env } = fakeSlotDb({ simple: { tier: "exhausted", exhausted_date: "2020-01-01" } });
    expect(await claimSlotAttempt(env, "simple")).toBeNull();
  });

  test("reasoning has no time-based backoff between retries", async () => {
    const { env } = fakeSlotDb({
      reasoning: { tier: "primary", consecutive_failures: 2, last_failure_at: new Date().toISOString() },
    });
    expect(await claimSlotAttempt(env, "reasoning")).toEqual({ tier: "primary" });
  });

  test("simple blocks a retry within 120s of the last failure", async () => {
    const { env } = fakeSlotDb({
      simple: { tier: "primary", consecutive_failures: 1, last_failure_at: new Date().toISOString() },
    });
    expect(await claimSlotAttempt(env, "simple")).toBeNull();
  });

  test("simple allows a retry once 120s have passed", async () => {
    const longAgo = new Date(Date.now() - 121_000).toISOString();
    const { env } = fakeSlotDb({
      simple: { tier: "secondary", consecutive_failures: 1, last_failure_at: longAgo },
    });
    expect(await claimSlotAttempt(env, "simple")).toEqual({ tier: "secondary" });
  });

  test("simple is not throttled at all when it is not mid a failure streak", async () => {
    const { env } = fakeSlotDb({ simple: { tier: "primary", consecutive_failures: 0, last_failure_at: null } });
    expect(await claimSlotAttempt(env, "simple")).toEqual({ tier: "primary" });
  });
});

describe("recordSlotFailure", () => {
  test("stays on primary below the escalation threshold", async () => {
    const { env, rows } = fakeSlotDb({ reasoning: { tier: "primary", consecutive_failures: 1 } });
    await recordSlotFailure(env, "reasoning", "boom");
    expect(rows.get("reasoning")).toMatchObject({ tier: "primary", consecutive_failures: 2 });
  });

  test("the 3rd consecutive failure on primary escalates to secondary and resets the counter", async () => {
    const { env, rows } = fakeSlotDb({ reasoning: { tier: "primary", consecutive_failures: 2 } });
    await recordSlotFailure(env, "reasoning", "boom");
    expect(rows.get("reasoning")).toMatchObject({ tier: "secondary", consecutive_failures: 0 });
  });

  test("the 3rd consecutive failure on secondary gives up for the day", async () => {
    const { env, rows } = fakeSlotDb({ simple: { tier: "secondary", consecutive_failures: 2 } });
    await recordSlotFailure(env, "simple", "boom");
    const row = rows.get("simple");
    expect(row.tier).toBe("exhausted");
    expect(row.consecutive_failures).toBe(0);
    expect(row.exhausted_date).toBe(new Date().toISOString().slice(0, 10));
  });

  test("records the error and its logging-only category", async () => {
    const { env, rows } = fakeSlotDb({ reasoning: { tier: "primary" } });
    await recordSlotFailure(env, "reasoning", "HTTP 403 (reset after 28s)");
    expect(rows.get("reasoning").last_error_category).toBe("quota_exhausted");
  });
});

describe("recordSlotSuccess", () => {
  test("resets the failure streak without touching the tier", async () => {
    const { env, rows } = fakeSlotDb({ simple: { tier: "secondary", consecutive_failures: 2, last_failure_at: "x" } });
    await recordSlotSuccess(env, "simple");
    expect(rows.get("simple")).toMatchObject({ tier: "secondary", consecutive_failures: 0, last_failure_at: null });
  });
});

describe("resetSlotEscalation and resetAllSlotsForNewDay", () => {
  test("resetSlotEscalation returns one slot to primary with a clean slate", async () => {
    const { env, rows } = fakeSlotDb({ reasoning: { tier: "exhausted", consecutive_failures: 0, exhausted_date: "2020-01-01" } });
    await resetSlotEscalation(env, "reasoning");
    expect(rows.get("reasoning")).toMatchObject({ tier: "primary", consecutive_failures: 0, exhausted_date: null });
  });

  test("resetAllSlotsForNewDay clears every slot", async () => {
    const { env, rows } = fakeSlotDb({
      reasoning: { tier: "exhausted", exhausted_date: "2020-01-01" },
      simple: { tier: "secondary", consecutive_failures: 2 },
    });
    await resetAllSlotsForNewDay(env);
    expect(rows.get("reasoning")).toMatchObject({ tier: "primary", consecutive_failures: 0, exhausted_date: null });
    expect(rows.get("simple")).toMatchObject({ tier: "primary", consecutive_failures: 0 });
  });
});

describe("classifyLlmError", () => {
  test.each([
    ["gemini_viax/ag/gemini-3-flash-agent: OpenAI API lỗi 403: {\"error\":{\"message\":\"[antigravity/gemini-3-flash-agent] [403]: HTTP 403 (reset after 28s)\"}}", "quota_exhausted"],
    ["openai_viax/gpt-5.6-luna: OpenAI API lỗi 503: {\"error\":{\"message\":\"No available accounts. Service is operating in degraded mode: all upstream accounts are unavailable\"}}", "quota_exhausted"],
    ["TypeError: fetch failed, network timeout", "unidentified"],
  ])("%s -> %s", (message, expected) => {
    expect(classifyLlmError(message)).toBe(expected);
  });
});

describe("completeJsonForSlot", () => {
  test("a BYO call (recordable: false) never writes to the slot state", async () => {
    const { env, rows } = fakeSlotDb({ reasoning: { tier: "primary" } });
    const okProvider = {
      name: "byo", model: "m",
      async completeJson() { return { content: "{}" }; },
      async completeText() { return { content: "" }; },
    } as any;
    await completeJsonForSlot(env, "reasoning", [okProvider], "sys", "user", { recordable: false });
    expect(rows.get("reasoning")).toMatchObject({ tier: "primary", consecutive_failures: 0, last_success_at: null });
  });

  test("a house-provider failure is recorded and rethrown", async () => {
    const { env, rows } = fakeSlotDb({ reasoning: { tier: "primary", consecutive_failures: 2 } });
    const failingProvider = {
      name: "openai_viax", model: "gpt-5.6-terra",
      async completeJson() { throw new Error("HTTP 403 (reset after 5s)"); },
      async completeText() { throw new Error("boom"); },
    } as any;
    await expect(
      completeJsonForSlot(env, "reasoning", [failingProvider], "sys", "user", { recordable: true })
    ).rejects.toThrow();
    expect(rows.get("reasoning")).toMatchObject({ tier: "secondary", consecutive_failures: 0 });
  });
});
