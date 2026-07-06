# CFL Feedback Intelligence — Cloudflare Worker (production backend)

Full rewrite of `../backend` (FastAPI) to Cloudflare Workers + D1, so the whole
app runs natively on Cloudflare. Same API contract as the FastAPI version — the
React frontend needs no changes beyond `VITE_API_BASE`.

**Live**: `https://cfl-feedback-worker.vinhviax.workers.dev` (Worker) +
`https://cfl-feedback.pages.dev` (Pages frontend).

## Stack

- **Hono** — router, same as Express-style routing
- **D1** — SQLite-compatible serverless DB (schema in `migrations/`)
- **Cron Triggers** — daily ingest + analysis (replaces APScheduler), `0 0 * * *` UTC
- **fetch()** — LLM calls (Anthropic/OpenAI) and Sensor Tower/Facebook Graph API,
  no SDKs needed since Workers doesn't support Python-style SDK clients
- **SheetJS (xlsx)** — Excel export, installed from `cdn.sheetjs.com` (the npm
  registry build has an unpatched ReDoS/prototype-pollution CVE)

## Local development

```bash
npm install
npx wrangler d1 migrations apply cfl-feedback --local
npm run dev          # wrangler dev on :8787, local D1 emulation
```

## Deploy

```bash
npx wrangler d1 migrations apply cfl-feedback --remote   # first time / schema changes
npm run deploy                                            # wrangler deploy
```

Then rebuild + redeploy the frontend (`../frontend`) with `VITE_API_BASE` pointing
at the deployed Worker URL:

```bash
cd ../frontend
echo "VITE_API_BASE=https://cfl-feedback-worker.<account>.workers.dev" > .env.production
npm run build
npx wrangler pages deploy ./dist --project-name=cfl-feedback
```

## Secrets

None are set yet — the app runs on the rule-based fallback classifier until
configured. Set via `wrangler secret put <NAME>`:

```bash
npx wrangler secret put SENSORTOWER_API_KEY
npx wrangler secret put FB_PAGE_ID
npx wrangler secret put FB_ACCESS_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY   # or OPENAI_API_KEY + set LLM_PROVIDER=openai in wrangler.jsonc vars
```

## Notes / known gaps vs. the FastAPI version

- **D1 bound-parameter limit**: D1 caps bound parameters per statement well
  below raw SQLite's default — `IN (...)` clauses are chunked at 90 items
  (see `chunk(..., 90)` calls in `services/`).
- **Progress tracking**: analyze-run progress is persisted to the `analyze_jobs`
  D1 table rather than in-memory state, since Workers module-level variables
  aren't reliably shared across requests/isolates.
- **Background processing**: `POST /api/analyze/run` uses `ctx.waitUntil()` to
  keep classifying after the response returns. It's resumable — re-running only
  processes comments still missing an analysis at the current `PROMPT_VERSION`,
  so a cut-off mid-run (or a very large dataset) just needs a second call.
- **LLM provider settings UI**: no in-app form to change provider/model; edit
  `vars` in `wrangler.jsonc` + secrets, then redeploy.
- **Workers subrequest limit (Free plan: 50/invocation, Paid: 10,000)**: `fetch()`
  and D1 calls both count against this. `ingestFacebook()` defaults to 10 posts
  and 2 comment-pages/post (~200 comments/post max) to stay under the Free-plan
  cap. If the account is on Workers Paid ($5/mo), these can be raised a lot
  (`postLimit` param, `MAX_COMMENT_PAGES_PER_POST` in `services/facebook.ts`) to
  pull more history per run — 10,000 subrequests comfortably covers a much
  larger Fanpage. A real bug was found and fixed here during development:
  `fetchPosts()` originally treated the Graph API `limit` param as a total cap,
  but it's actually a *page size* — `paging.next` keeps returning more pages
  regardless of it, so the old code walked the page's entire post history one
  `fetch()` at a time. Watch for the same mistake if extending Sensor Tower
  pagination (`services/sensortower.ts` already sizes pages correctly since it
  checks `reviews.length < limit` to stop, not a total-count cap).
