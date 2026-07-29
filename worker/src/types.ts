export interface Env {
  DB: D1Database;

  // vars (wrangler.jsonc "vars")
  // Provider/model selection is not here: see services/llmCatalog.ts and the
  // llm_agent_configs table.
  CLASSIFY_BATCH_SIZE: string;
  ANALYSIS_BATCH_SIZE?: string;
  TRANSLATION_BATCH_SIZE?: string;
  LLM_BATCH_CONCURRENCY?: string;
  PROCESSING_QUEUE_CONCURRENCY?: string;
  PROCESSING_JOB_MAX_BATCHES?: string;
  LLM_VIAX_BASE_URL?: string; // not secret - just an endpoint URL

  // secrets (wrangler secret put)
  SENSORTOWER_API_KEY?: string;
  FB_PAGE_ID?: string;
  FB_ACCESS_TOKEN?: string;
  // Credential for the Viax proxy. Other providers get theirs from
  // llm_provider_secrets, or from the caller for the bring-your-own-key ones.
  LLM_VIAX_API_KEY?: string;
}
