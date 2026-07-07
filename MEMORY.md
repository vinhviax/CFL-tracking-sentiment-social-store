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
- Branch lam viec hien tai: `main`
- Workspace dang lam trong session 2026-07-07: `J:\My Drive\CFL\Agent\Tracking Store Social`
- Checkout verify/deploy co dependency on dinh: `C:\Users\CPU13114\AppData\Local\Temp\cfl-feedback-worker-verify`
- Workspace chinh hien tai: `J:\My Drive\CFL\Agent\Tracking Store Social`
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

- Ingest CSV Facebook Group co preview day du 5 cot A-E: Source, Post Published Date, Post Message, Created Date, Comment Message; chi nhap dong co Source = `Group`, bo qua dong khac.
- Ingest Fanpage qua Graph API.
- Ingest Sensor Tower Store VN, Google Play `gp`, App Store `ios`.
- Cron Sensor Tower incremental theo cursor, chi keo ngay tiep theo den hom qua GMT+7.
- Auto process sau moi lan keo/upload ingest thanh cong: classify -> taxonomy memory/subtopics -> translate zh-CN theo thu tu. Nut analyze/translate trong UI chi de chay lai khi can.
- D1 migrations cho cursor, translation, saved insights, taxonomy memory.
- API comments/stats/overview/topic-ranking/subtopic-ranking.
- Manual run analyze/translate theo run.
- Insight va Summarize theo date range, user bam moi generate, co luu archive.
- UI Feedback Workspace gom Store/Facebook, filter date/source/topic/subtopic/sentiment/urgency/search/language.
- Light/Dark mode co persist localStorage.
- Ingest Settings hien ro run dang phan tich/dich gi, nguon nao, ngay nao, da xong bao nhieu.
- Ingest Settings co nut xoa tung ingest run; backend xoa comments/analyses/translations/subtopics/memory/progress jobs lien quan truoc khi xoa run.
- Ingest Settings co nut huy task dang cho/dang chay/bi loi; task da xong tu an khoi hang doi.
- Co cau hinh LLM Agent cho provider mac dinh worker hoac custom OpenAI-compatible endpoint/key/model; phan tich dung model cao, dich dung model thap.
- Log LLM hien theo batch trong hang doi xu ly, ten model duoc rut gon bo prefix provider/path.
- Prompt LLM trong code hien tai da duoc nang theo huong liveops: classifier doc hieu nguyen nhan van hanh thay vi keyword-only, translation zh-CN giu dung thuat ngu CFL/CFM/SEA/China, taxonomy memory gom subtopic theo nghia thay vi theo text lap.

## Taxonomy hien tai

Chude lon v3:

`lag_fps`, `crash_freeze`, `network_ping`, `login_account`, `account_ban_security`, `payment_topup`, `purchase_delivery`, `update_download`, `ui_control`, `gameplay_mode_map`, `shooting_mechanics`, `matchmaking`, `rank_competition`, `balance`, `hack_cheat`, `event_mission`, `reward_giftcode`, `gacha_rate`, `item_skin_weapon`, `social_chat_voice`, `community_behavior`, `customer_support`, `feature_request`, `content_esports`, `spam_ads_scam`, `game_comparison`, `positive_feedback`, `technical_other`, `other`

Prompt version trong code hien tai va production: `v4`. Da deploy Worker/Pages tu commit `0669ef4` trong session 2026-07-07.

Topic moi `game_comparison` hien label UI la `So Sánh Game`; dung cho comment nhac toi CFM, CrossFire Mobile, ban Trung/China, ban SEA, ban Viet/VN, global/quoc te hoac game khac lien quan, ke ca khi khong so sanh truc tiep.

Keyword rules nam o `worker/src/services/topicKeywords.ts`.

Subtopic memory:

- LLM phat hien chu de con sau moi run.
- Fallback detector bat cum 2-4 tu lap lai trong run.
- Neu cum xuat hien trong it nhat 3 comment cung topic va khong phai keyword lon qua chung, luu thanh subtopic candidate.
- Code hien tai co semantic canonicalization cho subtopic `update_download`: cac bien the nhu `cap nhat xong`, `phien ban moi`, `cap nhat moi`, `nhat xong` duoc gom ve `Cập nhật/phiên bản mới` thay vi tao nhieu subtopic theo exact text.
- Prompt taxonomy memory yeu cau gop cac cach dien dat cung nghia, khong tao chu de con chi vi mot n-gram/cum chu lap lai.
- API subtopic ranking/filter gom alias subtopic cu bang danh sach key, nen dropdown khong con lap cac bien the text cua cung mot y sau khi deploy.

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
- CSV Group file lon gap 2 gioi han khac nhau: dedupe lookup `IN (...)` phai chunk nho de khong vuot SQL variable, nhung insert `db.batch` phai du lon de khong tao qua nhieu D1 subrequest trong mot Worker invocation. Ban moi giu dedupe 45 rows/chunk va insert 100 rows/batch.
- Facebook pagination khong duoc keo vo han; giu limit de tranh Too many subrequests.
- Worker background job dung `ctx.waitUntil`; progress khong luu in-memory ma luu D1.
- CSV Facebook Group chi nhap dong co cot A/source = `Group`; dong Fanpage trong file CSV bi bo qua. Neu file khong co dong Group moi hoac toan duplicate, upload bi tu choi truoc khi tao ingest run.
- Store Sensor Tower ngay hien thi co fix de uu tien requested range va parse ngay nguon khong bi lech timezone. Run cu da import truoc fix co the van mang data date cu trong D1 neu khong xoa/keo lai.
- PowerShell hien thi UTF-8 qua `ConvertTo-Json` co the mojibake tren console, khong dong nghia API loi encoding.
