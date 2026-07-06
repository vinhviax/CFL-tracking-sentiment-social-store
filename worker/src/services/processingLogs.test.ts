import { describe, expect, test, vi } from "vitest";
import { addProcessingLog, listProcessingJobLogs } from "./processingLogs";

describe("processing logs", () => {
  test("inserts LLM batch log metadata without prompt or response bodies", async () => {
    const calls: { sql: string; args: any[] }[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return {
            bind(...args: any[]) {
              calls.push({ sql, args });
              return this;
            },
            run: vi.fn(async () => ({ meta: { changes: 1 } })),
          };
        },
      },
    } as any;

    await addProcessingLog(env, {
      processing_job_id: 7,
      progress_key: "ingest-store-analyze-7",
      job_type: "analysis",
      level: "success",
      phase: "llm_batch",
      message: "Batch 1/4 completed",
      batch_index: 1,
      batch_total: 4,
      item_count: 50,
      provider: "llm_viax",
      model: "ag/gemini-3-flash-agent",
      duration_ms: 1324,
    });

    expect(calls[0].sql).toContain("INSERT INTO processing_logs");
    expect(calls[0].args).toEqual(expect.arrayContaining([
      7,
      "ingest-store-analyze-7",
      "analysis",
      "success",
      "llm_batch",
      "Batch 1/4 completed",
      1,
      4,
      50,
      "llm_viax",
      "ag/gemini-3-flash-agent",
      1324,
      null,
    ]));
  });

  test("lists recent logs newest first for a processing job", async () => {
    const calls: { sql: string; args: any[] }[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return {
            bind(...args: any[]) {
              calls.push({ sql, args });
              return this;
            },
            async all() {
              return {
                results: [
                  {
                    id: 9,
                    processing_job_id: 7,
                    progress_key: "ingest-store-analyze-7",
                    job_type: "analysis",
                    level: "success",
                    phase: "llm_batch",
                    message: "Batch 2/4 completed",
                    batch_index: 2,
                    batch_total: 4,
                    item_count: 50,
                    provider: "llm_viax",
                    model: "ag/gemini-3-flash-agent",
                    duration_ms: 1500,
                    error: null,
                    created_at: "2026-07-07T03:00:00.000Z",
                  },
                ],
              };
            },
          };
        },
      },
    } as any;

    await expect(listProcessingJobLogs(env, 7, { limit: 5 })).resolves.toEqual([
      {
        id: 9,
        processing_job_id: 7,
        progress_key: "ingest-store-analyze-7",
        job_type: "analysis",
        level: "success",
        phase: "llm_batch",
        message: "Batch 2/4 completed",
        batch_index: 2,
        batch_total: 4,
        item_count: 50,
        provider: "llm_viax",
        model: "ag/gemini-3-flash-agent",
        duration_ms: 1500,
        error: null,
        created_at: "2026-07-07T03:00:00.000Z",
      },
    ]);
    expect(calls[0].sql).toContain("WHERE processing_job_id = ?");
    expect(calls[0].sql).toContain("ORDER BY id DESC");
    expect(calls[0].args).toEqual([7, 5]);
  });
});
