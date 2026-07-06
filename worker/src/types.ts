export interface Env {
  DB: D1Database;

  // vars (wrangler.jsonc "vars")
  LLM_PROVIDER: string;
  LLM_CLASSIFY_MODEL: string;
  LLM_INSIGHT_MODEL: string;
  LLM_TRANSLATE_MODEL?: string;
  CLASSIFY_BATCH_SIZE: string;
  ANALYSIS_BATCH_SIZE?: string;
  TRANSLATION_BATCH_SIZE?: string;
  LLM_BATCH_CONCURRENCY?: string;
  PROCESSING_QUEUE_CONCURRENCY?: string;
  LLM_VIAX_BASE_URL?: string; // not secret - just an endpoint URL

  // secrets (wrangler secret put)
  SENSORTOWER_API_KEY?: string;
  FB_PAGE_ID?: string;
  FB_ACCESS_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  LLM_BASE_URL?: string;
  LLM_VIAX_API_KEY?: string; // custom OpenAI-compatible provider ("LLM Viax")
}
