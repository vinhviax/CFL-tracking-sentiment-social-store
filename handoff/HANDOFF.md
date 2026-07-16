# HANDOFF 2026-07-16

Ban giao cho agent/session tiep theo cua project **CFL Feedback Intelligence**.

## Trang thai hien tai

- Workspace: `J:\My Drive\CFL\Agent\Tracking Store Social`
- Repo GitHub: `https://github.com/vinhviax/CFL-tracking-sentiment-social-store.git`
- Branch: `main`
- Commit moi nhat da push: `20e9c35 fix: typecheck worker config regression test`
- Worker production: `https://cfl-feedback-worker.vinhviax.workers.dev`
- Pages production: `https://cfl-feedback.pages.dev` (khong deploy trong session nay)
- Worker deploy version moi nhat: `eaa2cd6d-d449-4181-8f8c-524dd95737dd`

## Thay doi moi nhat

Da nang cap model LLM theo dung scope, khong doi provider, endpoint, secret, batch/concurrency hay fallback.

| Tac vu | Cau hinh/hieu luc hien tai |
| --- | --- |
| Insight va HTML Report | `codex-lb/gpt-5.6-terra` qua `LLM_INSIGHT_MODEL` |
| `reasoning`: phan tich comment, taxonomy/subtopic | Override D1 dang bat: `custom` -> `codex-lb/gpt-5.6-terra` |
| `simple`: dich zh-CN | Override D1 dang luu `custom` -> `codex-lb/gpt-5.6-luna`, nhung `enabled=false` |
| Dich thuc te khi simple tat | Default `ag/gemini-3-flash-agent` qua `llm_viax` |

Source da thay doi:

- `worker/wrangler.jsonc`: `LLM_INSIGHT_MODEL=codex-lb/gpt-5.6-terra`.
- `worker/src/workerConfig.test.ts`: regression test giu dung 3 model default Worker.
- `worker/package.json`, `worker/package-lock.json`, `worker/tsconfig.json`: them Node typings de test config typecheck duoc.

Luu y luong goi LLM:

- Analysis va taxonomy memory resolve slot `reasoning`, nen dang chay Terra qua custom endpoint.
- Translation resolve slot `simple`; do override tat nen dang chay Gemini Flash Agent mac dinh.
- Insight/Report goi truc tiep `LLM_INSIGHT_MODEL`, khong dung slot override.

## Verify va deploy da chay

Vi `node_modules` trong Google Drive khong on dinh, Worker da duoc verify o copy local dung commit `20e9c35`:

`C:\Temp\cfl-feedback-worker-20e9c35-20260716\worker`

Ket qua:

- Focused Worker tests: `9/9` pass.
- Full Worker tests: `30/30 test files`, `126/126 tests` pass.
- Worker typecheck: pass.
- Worker deploy: version `eaa2cd6d-d449-4181-8f8c-524dd95737dd`.
- `/api/health`: `status=ok`, `llm_provider=llm_viax`, `llm_ready=true`, `prompt_version=v4`.
- `/api/llm-config`: reasoning custom/Terra bat; simple custom/Luna tat; API key van ton tai va chi hien masked.
- Smoke test `POST /api/insights/generate` (khong luu insight): response `provider=llm_viax`, `model=codex-lb/gpt-5.6-terra`, xac nhan Insight runtime dang dung Terra.

## Git status can chu y

Hai file Demo Report duoi day da staged truoc session, khong phai thay doi cua model upgrade/documentation va khong duoc dua vao commit neu user khong yeu cau:

- `Demo Report/CFL_Monthly_Social_Sentiment_Store_Review_Thang_2026_06 ver 3.html`
- `Demo Report/CFL_Social Sentiment Update 4.0 - 7D.html`

Khi commit tiep, dung:

```powershell
git commit --only -m "message" -- <paths>
```

Worktree tam `codex/llm-model-upgrade` da unregistered va branch da xoa sau khi merge. Neu con thu muc ignored `.worktrees/llm-model-upgrade` thi do file lock/permission tren Google Drive; khong lien quan Git state.

## Lenh nhanh

Production smoke:

```powershell
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/health"
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/llm-config"
```

Kiem tra model Insight runtime (tao summary nhung khong luu archive):

```powershell
$body = @{ filters = @{ group = 'store'; from = '2026-07-01'; to = '2026-07-01' }; lang = 'vi' } | ConvertTo-Json -Depth 4
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/insights/generate" -Method Post -ContentType "application/json" -Body $body
```

Khi can verify/deploy lai Worker, copy source commit can dung ra thu muc local ngoai Google Drive, chay `npm ci`, `npm test`, `npm run typecheck`, sau do `npx wrangler deploy` tu thu muc `worker` cua copy local.
