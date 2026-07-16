# LLM Model Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the configured Insight/Report and reasoning models to GPT-5.6 Terra, and record GPT-5.6 Luna for the disabled simple override.

**Architecture:** Worker environment variables remain the source of deploy-time defaults, while the D1-backed `llm_agent_configs` rows selectively override the reasoning and simple provider slots at runtime. The change updates the Insight environment default and the two production D1 rows without changing provider-selection code.

**Tech Stack:** Cloudflare Workers, Wrangler JSONC, D1, Hono, TypeScript, Vitest.

## Global Constraints

- Set `LLM_INSIGHT_MODEL` exactly to `codex-lb/gpt-5.6-terra`.
- Keep `LLM_CLASSIFY_MODEL` and `LLM_TRANSLATE_MODEL` at `ag/gemini-3-flash-agent`.
- Keep provider, endpoint, API keys, concurrency, batch sizes, and fallback logic unchanged.
- Set the enabled production `reasoning` override to `codex-lb/gpt-5.6-terra`.
- Set the disabled production `simple` override to `codex-lb/gpt-5.6-luna`; do not enable it.
- Do not stage or commit either pre-existing Demo Report file.

---

### Task 1: Lock the Worker model defaults with a regression test

**Files:**
- Create: `worker/src/workerConfig.test.ts`
- Modify: `worker/wrangler.jsonc:24-27`

**Interfaces:**
- Consumes: `worker/wrangler.jsonc` `vars` object.
- Produces: a regression assertion that guards the three Worker model default values.

- [ ] **Step 1: Write the failing test**

Create `worker/src/workerConfig.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

function workerConfig() {
  return readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
}

describe("Worker LLM model defaults", () => {
  test("uses the approved GPT-5.6 Terra insight model without changing Gemini defaults", () => {
    expect(workerConfig()).toContain('"LLM_CLASSIFY_MODEL": "ag/gemini-3-flash-agent"');
    expect(workerConfig()).toContain('"LLM_INSIGHT_MODEL": "codex-lb/gpt-5.6-terra"');
    expect(workerConfig()).toContain('"LLM_TRANSLATE_MODEL": "ag/gemini-3-flash-agent"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/workerConfig.test.ts`

Expected: FAIL because `LLM_INSIGHT_MODEL` is still `codex-lb/gpt-5.4`.

- [ ] **Step 3: Write minimal implementation**

In `worker/wrangler.jsonc`, replace only the Insight variable:

```jsonc
"LLM_INSIGHT_MODEL": "codex-lb/gpt-5.6-terra",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/workerConfig.test.ts`

Expected: PASS, one test passing.

- [ ] **Step 5: Commit the source configuration**

```powershell
git add -- worker/src/workerConfig.test.ts worker/wrangler.jsonc
git commit --only -m "feat: upgrade default insight model to GPT-5.6 Terra" -- worker/src/workerConfig.test.ts worker/wrangler.jsonc
```

### Task 2: Update the persisted production slot overrides

**Files:**
- Modify: production D1 rows accessed through `PUT /api/llm-config/reasoning` and `PUT /api/llm-config/simple`

**Interfaces:**
- Consumes: existing D1 records returned by `GET /api/llm-config`, preserving their provider, endpoint, masked secret, and enabled state.
- Produces: `reasoning.model = codex-lb/gpt-5.6-terra` with `enabled=true`; `simple.model = codex-lb/gpt-5.6-luna` with `enabled=false`.

- [ ] **Step 1: Capture the existing sanitized configuration**

Run:

```powershell
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/llm-config" | ConvertTo-Json -Depth 10
```

Expected: record the existing `provider`, `endpoint_url`, and `enabled` properties before mutation; never print or supply the raw secret.

- [ ] **Step 2: Update reasoning, preserving all non-model settings**

Run:

```powershell
$body = @{ enabled = $true; provider = "custom"; endpoint_url = "https://agent-shop.clawd.io.vn/v1"; model = "codex-lb/gpt-5.6-terra" } | ConvertTo-Json
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/llm-config/reasoning" -Method Put -ContentType "application/json" -Body $body
```

Expected: response has `slot: reasoning`, `enabled: true`, and model `codex-lb/gpt-5.6-terra`; `has_api_key` remains true.

- [ ] **Step 3: Update simple, retaining its disabled state**

Run:

```powershell
$body = @{ enabled = $false; provider = "custom"; endpoint_url = "https://agent-shop.clawd.io.vn/v1"; model = "codex-lb/gpt-5.6-luna" } | ConvertTo-Json
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/llm-config/simple" -Method Put -ContentType "application/json" -Body $body
```

Expected: response has `slot: simple`, `enabled: false`, and model `codex-lb/gpt-5.6-luna`; `has_api_key` remains true.

### Task 3: Deploy and verify the complete effective configuration

**Files:**
- Deploy: `worker/wrangler.jsonc` to `cfl-feedback-worker`

**Interfaces:**
- Consumes: committed Worker config and D1 overrides from Task 2.
- Produces: deployed Insight variable and verified production configuration.

- [ ] **Step 1: Run focused regression tests**

Run: `npm test -- src/workerConfig.test.ts src/services/llmAgentConfig.test.ts src/services/insights.test.ts`

Expected: PASS with no failing test.

- [ ] **Step 2: Run Worker typecheck and full test suite**

Run:

```powershell
npm test
npm run typecheck
```

Expected: all tests pass and typecheck exits with status 0.

- [ ] **Step 3: Deploy Worker**

Run: `npx wrangler deploy`

Expected: Wrangler prints the production Worker URL and new version ID.

- [ ] **Step 4: Verify production defaults and overrides**

Run:

```powershell
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/health" | ConvertTo-Json -Depth 10
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/llm-config" | ConvertTo-Json -Depth 10
```

Expected: health is `ok`; defaults have Insight `codex-lb/gpt-5.6-terra`; enabled reasoning is Terra; disabled simple is Luna.

- [ ] **Step 5: Commit only source/test changes and report deployment evidence**

```powershell
git status --short
```

Expected: only the two pre-existing staged Demo Report files remain outside the model-upgrade commit.
