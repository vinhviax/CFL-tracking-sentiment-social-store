# MEMORY.md

Thong tin song cua project **CFL Feedback Intelligence**.

## Muc tieu project

Web app noi bo de team van hanh game **Crossfire Legends (CFL)** theo doi feedback user tu:

- Store: Google Play va App Store VN qua Sensor Tower API.
- Facebook: Fanpage qua Facebook Graph API.
- Facebook Group: user upload CSV thu cong.

He thong keo/nhap data, dedupe comment, phan loai bang LLM, dich zh-CN, luu vao D1, hien thi dashboard Feedback Workspace de doc comment, xem topic ranking, sentiment, subtopic, Insight va Summarize.

## Kien truc hien tai

- `worker/`: Cloudflare Worker production, Hono + D1.
- `frontend/`: React + Vite, deploy Cloudflare Pages.
- `backend/`: FastAPI legacy/du phong, khong phai backend production hien tai.
- Database production: Cloudflare D1 `cfl-feedback`.
- API production: `https://cfl-feedback-worker.vinhviax.workers.dev`
- Frontend production: `https://cfl-feedback.pages.dev`

## Repo va workspace

- GitHub: `https://github.com/vinhviax/CFL-tracking-sentiment-social-store.git`
- Branch feature hien tai: `codex/sensortower-zh-workspace`
- Workspace moi de lam tiep: `J:\My Drive\CFL\Agent\Tracking Store Social`
- Workspace cu: `G:\CFM\Research\Crossfire Legends Sea`

## Cloudflare config

Worker config nam o `worker/wrangler.jsonc`.

- Worker name: `cfl-feedback-worker`
- D1 binding: `DB`
- D1 database_id: `3ec76280-4616-4e4b-b343-d95d0ec432cc`
- Cron: `45 6 * * *` UTC = 13:45 GMT+7 moi ngay.
- LLM provider: `llm_viax`
- Classify model: `ag/gemini-3-flash-agent`
- Insight model: `codex-lb/gpt-5.4`
- LLM base URL: `https://rpi7jss.abc-tunnel.us/v1`

## Secrets

Khong commit secret. Khong nhap secret thay user.

Secrets dang can tren Cloudflare Worker:

- `LLM_VIAX_API_KEY`: da tung verify la co key va `/api/health` tra `llm_ready: true`.
- `FB_PAGE_ID`: Fanpage CFL.
- `FB_ACCESS_TOKEN`: Page Access Token.
- `SENSORTOWER_API_KEY`: can key hop le de keo Sensor Tower.

Neu user bao key loi, huong dan chay:

```powershell
cd worker
npx wrangler secret put LLM_VIAX_API_KEY
npx wrangler secret put SENSORTOWER_API_KEY
npx wrangler secret put FB_ACCESS_TOKEN
```

## Chuc nang da co

- Ingest CSV Facebook Group co preview va dedupe.
- Ingest Fanpage qua Graph API.
- Ingest Sensor Tower Store VN, Google Play `gp`, App Store `ios`.
- Cron Sensor Tower incremental theo cursor, chi keo ngay tiep theo den hom qua GMT+7.
- Auto process sau ingest: classify, translate zh-CN, taxonomy memory/subtopics.
- D1 migrations cho cursor, translation, saved insights, taxonomy memory.
- API comments/stats/overview/topic-ranking/subtopic-ranking.
- Manual run analyze/translate theo run.
- Insight va Summarize theo date range, user bam moi generate, co luu archive.
- UI Feedback Workspace gom Store/Facebook, filter date/source/topic/subtopic/sentiment/urgency/search/language.
- Light/Dark mode co persist localStorage.
- Ingest Settings hien ro run dang phan tich/dich gi, nguon nao, ngay nao, da xong bao nhieu.

## Taxonomy hien tai

Chude lon:

`function`, `ping_network`, `bug`, `event`, `hack_cheat`, `payment_topup`, `login_account`, `performance_lag_crash`, `update_patch`, `customer_support`, `gameplay`, `matchmaking`, `balance`, `reward_gift`, `community_player_behavior`, `item_skin`, `gacha`, `esports_content`, `suggestion_request`, `spam_ads`, `other`

Prompt version hien tai: `v2`.

Keyword rules nam o `worker/src/services/topicKeywords.ts`.

Subtopic memory:

- LLM phat hien chu de con sau moi run.
- Fallback detector bat cum 2-4 tu lap lai trong run.
- Neu cum xuat hien trong it nhat 3 comment cung topic va khong phai keyword lon qua chung, luu thanh subtopic candidate.

## Lenh verify chinh

Worker:

```powershell
cd worker
npm test
npm run typecheck
npx wrangler deploy
```

Frontend:

```powershell
cd frontend
npm run build
npx wrangler pages deploy ./dist --project-name=cfl-feedback
```

Production health:

```powershell
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/health"
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/meta"
```

## Luu y bug/han che da gap

- D1 unique constraint co the loi neu dedupe hash trung khi upload CSV/Sensor Tower; ingest service da co dedupe, neu sua can giu logic idempotent.
- D1 bound parameter limit thap, query `IN` can chunk.
- Facebook pagination khong duoc keo vo han; giu limit de tranh Too many subrequests.
- Worker background job dung `ctx.waitUntil`; progress khong luu in-memory ma luu D1.
- PowerShell hien thi UTF-8 qua `ConvertTo-Json` co the mojibake tren console, khong dong nghia API loi encoding.
