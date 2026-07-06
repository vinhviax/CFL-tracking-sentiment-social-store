export interface Env {
  DB: D1Database;

  // vars (wrangler.jsonc "vars")
  LLM_PROVIDER: string;
  LLM_CLASSIFY_MODEL: string;
  LLM_INSIGHT_MODEL: string;
  CLASSIFY_BATCH_SIZE: string;

  // secrets (wrangler secret put)
  SENSORTOWER_API_KEY?: string;
  FB_PAGE_ID?: string;
  FB_ACCESS_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  LLM_BASE_URL?: string;
}
