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
- Workspace dang lam: `J:\My Drive\CFL\Agent\Tracking Store Social`
- Checkout verify/deploy can nam ngoai Google Drive. Ban dung hien tai: **`C:\Temp\cfl-export-20260720-1442`** (co ca `worker/` va `frontend/`, da `npm ci`; kiem tra 2026-07-29: `worker/src`, `frontend/src`, `wrangler.jsonc` khop J:). Truoc khi build/deploy luon `diff -rq` voi J: — **ban copy cu chua code cu van chay duoc, nen deploy tu ban sai se am tham day code lac hau len production**. (Ban cu `C:\Temp\cfl-feedback-worker-20e9c35-20260716` da xoa 2026-07-29 vi dung chinh cai bay nay.)
- Workspace chinh hien tai: `J:\My Drive\CFL\Agent\Tracking Store Social`
- Workspace cu: `G:\CFM\Research\Crossfire Legends Sea`

## Cloudflare config

Worker config nam o `worker/wrangler.jsonc`.

- Worker name: `cfl-feedback-worker`
- D1 binding: `DB`
- D1 database_id: `3ec76280-4616-4e4b-b343-d95d0ec432cc`
- Cron (3 cai, dispatch trong `scheduled()` bang cach so khop chuoi cron):
  - `45 6 * * *` UTC = 13:45 GMT+7: daily ingest (`dailyJob`).
  - `0 7 * * *` UTC = 14:00 GMT+7: reset trang thai leo thang LLM + enqueue lai phan con thieu (`dailySlotResetJob`).
  - `*/5 * * * *`: sweep hang doi (`sweepProcessingQueue`) — chi thu hoi job treo/failed va drain, KHONG tao job moi.
- LLM base URL cua proxy Viax: `https://rpi7jss.abc-tunnel.us/v1` (env `LLM_VIAX_BASE_URL`, secret `LLM_VIAX_API_KEY`).
- Endpoint/key cua provider `openai_viax` (`agent-shop.clawd.io.vn`) nam trong bang D1 `llm_provider_secrets`, KHONG nam trong wrangler.jsonc/env.
- Tai khoan Cloudflare hien dang **Free plan** (xac nhan 2026-08-14 khi deploy bi tu choi voi loi "CPU limits are not supported for the Free plan"). `wrangler.jsonc` tung co `limits.cpu_ms = 60000` de tranh loi giai ma+hash file CSV Facebook lon vuot qua 30s CPU mac dinh — da **xoa dong nay 2026-08-14 de deploy duoc tren Free plan**, gio quay lai gioi han CPU mac dinh (30s). Neu upload lai file CSV Facebook rat lon (~17k dong nhu run #133) va thay loi timeout/giai ma o buoc ingest, day la nguyen nhan — nguoi dung da duoc bao va chap nhan chia nho file khi upload thay vi nang lai limit (can Cloudflare plan tra phi moi cau hinh lai duoc `limits.cpu_ms`).

## LLM: catalog provider + co che leo thang co trang thai (tu 2026-07-30)

Kien truc "custom provider override" cu (D1 slot override tro thang toi `agent-shop.clawd.io.vn` voi model prefix `codex-lb/`) **da bi thay the hoan toan**. Gio la 1 catalog co dinh 6 provider (`worker/src/services/llmCatalog.ts`), 2 slot co dinh:

- `reasoning` (phan tich comment, xuat report HTML, Insight, gameplay-mode verify, taxonomy discovery): chinh = `openai_viax`/`gpt-5.6-terra`, phu = `gemini_viax`/`ag/gemini-3.6-flash-high`.
- `simple` (dich zh-CN): chinh = `gemini_viax`/`ag/gemini-3.6-flash-high`, phu = `openai_viax`/`gpt-5.6-luna`.

Model cua `gemini_viax` doi tu `ag/gemini-3-flash-agent` sang `ag/gemini-3.6-flash-high` ngay 2026-08-14 (migration `0016`). Ten cu VAN con trong catalog de doi lai duoc tu UI khong can deploy. **Doi model trong catalog code la KHONG DU**: bang `llm_agent_configs` da co dong seed tu migration `0012`, va `getSlotSelection` uu tien dong trong D1 — phai co migration UPDATE kem theo, neu khong production van goi model cu (tien le: `0013`).

Moi slot co 1 dong trong bang `llm_slot_state` (migration `0015`) theo doi `tier` (`primary`/`secondary`/`exhausted`) va `consecutive_failures`. Luong: chinh -> 3 loi lien tiep -> phu -> 3 loi nua -> dung goi LLM het ngay (comment de nguyen trang thai chua xu ly, KHONG con fallback tu khoa/copy nguyen van nhu truoc). Cron `0 7 * * *` reset ca 2 slot ve primary. Slot `simple` co them backoff 120s giua cac lan thu lai SAU LOI (khong phai gioi han thong luong khi dang chay khoe). Module chinh: `worker/src/services/llmSlotState.ts`. Xem chi tiet thiet ke + cac diem de vo trong `handoff/HANDOFF.md` phien 2026-07-30.

`resolveLlmProviderChain` (`worker/src/services/llmAgentConfig.ts`) gio tra ve toi da 1 provider (tier dang active), khong con tu dong noi `gemini_viax` lam safety net vao moi lan goi nhu truoc.

BYO (nguoi dung tu nhap key qua header `x-cfl-llm-config`) van hoat dong nhu cu, doc lap hoan toan voi co che leo thang tren.

## Secrets

Khong commit secret. Khong nhap secret thay user.

Secrets dang can tren Cloudflare Worker:

- `ADMIN_PASSWORD`: mat khau chung mo khoa phan ghi cua tab Ingest & Cai dat. **Chua set = workspace mo**, ai co link cung keo/xoa/chay lai LLM duoc; trang Ingest hien banner do canh bao. Xem muc "Khoa quan tri" ben duoi.
- `LLM_VIAX_API_KEY`: da tung verify la co key va `/api/health` tra `llm_ready: true`.
- `FB_PAGE_ID`: Fanpage CFL.
- `FB_ACCESS_TOKEN`: Page Access Token.
- `SENSORTOWER_API_KEY`: can key hop le de keo Sensor Tower.

Neu user bao key loi, huong dan chay:

```powershell
cd worker
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put LLM_VIAX_API_KEY
npx wrangler secret put SENSORTOWER_API_KEY
npx wrangler secret put FB_ACCESS_TOKEN
```

## Khoa quan tri (Ingest & Cai dat chi xem)

Link workspace chia cho nhieu nguoi. Moi nguoi doc duoc het; chi nguoi co `ADMIN_PASSWORD` ghi duoc tren tab Ingest & Cai dat.

- Bien gioi that nam o Worker: `worker/src/services/adminAuth.ts` (middleware `requireAdmin`), mount trong `index.ts` cho `/api/ingest/*`, `/api/llm-config/*`, `/api/analyze/*`, `/api/translate/*`, `/api/runs/*`, `/api/processing/*`. Nut bi mo o frontend chi la phan anh, khong phai bao mat.
- Chi chan method ghi (POST/PUT/PATCH/DELETE). GET luon qua, nen viewer van xem duoc trang thai, lich su, token, va cac GET poll van drain duoc hang doi xu ly.
- **Ngoai pham vi co y**: `/api/comments` PATCH va `/api/insights/*` van mo — Feedback Workspace khong bi khoa.
- Endpoint cua khoa: `GET /api/admin/status` -> `{lock_enabled, authorized}`, `POST /api/admin/unlock {password}`. Ca hai deu KHONG nam sau `requireAdmin`.
- Header mang key: `X-CFL-Admin-Key`. Frontend giu trong `sessionStorage` (`frontend/src/utils/adminSession.js`) — F5 con, dong tab la mat. Khong bao gio de key vao query string.
- Chua set secret thi Worker **fail-open** (moi nguoi ghi duoc) chu khong fail-closed, de deploy code moi khong khoa luon chinh owner ra ngoai. Canh bao hien bang banner do tren trang Ingest.
- Doi mat khau: chay lai `wrangler secret put ADMIN_PASSWORD`. Tab dang mo khoa se tu roi ve chi xem o lan `/api/admin/status` ke tiep.

## Chuc nang da co

- Ingest CSV Facebook co preview day du 5 cot A-E: Source, Post Published Date, Post Message, Created Date, Comment Message. Nhap **ca dong Source = `Fanpage` (→ `fb_page`) va `Group` (→ `fb_group_csv`)**, bo qua dong khac (vd `Store`). Cot sau E bi bo qua co y — LLM analysis moi la nguon su that cho topic/sentiment. Gioi han **60.000 dong/lan nap**, vuot thi bao user chia file (nap trung lap an toan vi dedupe theo `dedupe_hash`).
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
- Cau hinh LLM Agent qua UI (`/api/llm-config`): chon provider/model cho 2 slot `reasoning`/`simple` tu catalog 6 provider co dinh (2 "by Viax" luu duoc, 3 "chinh chu" + `custom` la BYO khong luu). UI cung hien trang thai leo thang moi slot (dang dung provider chinh/phu/da dung hom nay).
- Log LLM hien theo batch trong hang doi xu ly, ten model duoc rut gon bo prefix provider/path. Bang "Token da dung" gop dong theo ten model rut gon de khong hien 2 dong trung ten do doi kien truc provider.
- Hang doi xu ly (`processing_queue`) phan biet 3 trang thai o UI: dang xep hang chua toi luot / tam dung giua luot / treo that (co ghi vi tri hang doi).
- Prompt LLM trong code hien tai da duoc nang theo huong liveops: classifier doc hieu nguyen nhan van hanh thay vi keyword-only, translation zh-CN giu dung thuat ngu CFL/CFM/SEA/China, taxonomy memory gom subtopic theo nghia thay vi theo text lap.

## Taxonomy hien tai

Chude lon v3:

`lag_fps`, `crash_freeze`, `network_ping`, `login_account`, `account_ban_security`, `payment_topup`, `purchase_delivery`, `update_download`, `ui_control`, `gameplay_mode_map`, `shooting_mechanics`, `matchmaking`, `rank_competition`, `balance`, `hack_cheat`, `event_mission`, `reward_giftcode`, `gacha_rate`, `item_skin_weapon`, `social_chat_voice`, `community_behavior`, `customer_support`, `feature_request`, `content_esports`, `spam_ads_scam`, `game_comparison`, `positive_feedback`, `technical_other`, `other`

Prompt version trong code hien tai va production: `v4`.

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
- CSV Facebook file lon tung gap 2 gioi han nguoc chieu nhau: dedupe lookup `IN (...)` phai chunk nho (bound parameter limit ~90) nhung nhu vay so subrequest lai tang theo so dong, va ~30k dong da vuot 1000 subrequest/invocation. Da fix (commit `c32e9ed`): khong con gui hash cua file vao `IN (...)` nua — dedupe quet `comments` trong khoang ngay cua file (phan trang 5000/lan), post quet theo prefix `fanpage_csv:`/`group_csv:`, nen chi phi lookup khong con ti le voi so dong file. Insert batch 100 -> 250 (gioi han 100 bound param la MOI STATEMENT, khong phai moi batch). **Dung quay lai kieu chunk `IN (...)` theo hash cua file.** Gioi han cung hien tai: 60.000 dong/lan nap (`CSV_MAX_IMPORTABLE_ROWS`), vuot thi bao nguoi dung chia file; qua nguong nay Worker het memory 128MB khi decode file chu khong phai het subrequest.
- Facebook pagination khong duoc keo vo han; giu limit de tranh Too many subrequests.
- Worker background job dung `ctx.waitUntil`; progress khong luu in-memory ma luu D1.
- CSV Facebook nhap ca dong `Fanpage` va `Group` o cot A (ghi chu cu "chi nhap dong Group" da lac hau). Neu file khong co dong Fanpage/Group hop le, hoac toan bo la duplicate, upload bi tu choi **truoc khi tao ingest run** (khong de lai run rac).
- Store Sensor Tower ngay hien thi co fix de uu tien requested range va parse ngay nguon khong bi lech timezone. Run cu da import truoc fix co the van mang data date cu trong D1 neu khong xoa/keo lai.
- PowerShell hien thi UTF-8 qua `ConvertTo-Json` co the mojibake tren console, khong dong nghia API loi encoding.
- `node_modules` trong Google Drive co the loi/hang khi chay Vitest/TypeScript. Copy Worker dung commit can verify ra thu muc local (vi du `C:\Temp\...\worker`), chay `npm ci`, roi chay test/typecheck/deploy tu do.
- `git fsck --no-dangling` tren checkout Google Drive session 2026-07-16 in nhieu dong `bad sha1 file` du exit code 0. Git status/log/push van hoat dong, nhung khong tu sua/xoa object trong `.git`; neu can kiem tra/repair Git nghiem ngat, clone repo ra o local drive truoc.
- `worker/node_modules/typescript` tren `J:` (Google Drive) bi loi sync (`ERR_INVALID_PACKAGE_CONFIG`) va `vitest` treo vo han o do. Test/typecheck/build/deploy PHAI chay tu ban mirror local `C:\Temp\cfl-export-20260720-1442\` (khong phai git repo — chi copy file vua sua sang do roi chay). Xem chi tiet quy trinh o memory Claude Code (`cfl-run-tests-from-local-mirror`).
- `enqueueJobs` (`processing_queue`, `ON CONFLICT DO UPDATE`) phai cap nhat CA `force`/`comment_ids_json`/`locale`/`limit_count` khi row o trang thai ket thuc, khong chi `status`/`attempts`/`started_at`. Neu quen, mot progress_key da tung force 1 lan se giu `force=1` vinh vien, khien lan bam "Phan tich"/"Dich" binh thuong sau do van quet lai ca run (da xay ra that voi run #73, sua ngay `1545046`).
- `pendingTranslations` (`worker/src/services/translation.ts`) khong-force chi chon comment CHUA co dong nao trong `comment_translations` (`t.comment_id IS NULL`). Comment da co dong (vd `message_translated` xong nhung `summary_translated` rong — tinh trang nay xay ra khi phan tich lai sau khi dich da chay) se KHONG BAO GIO duoc chon lai neu khong `force`. Day la ly do can `force:true` thu cong cho cac dot "dich lai summary", va la viec can sua o dau phien sau (xem handoff 2026-07-30 phien 3).
- Co 2 Demo Report cua user dang staged va khong duoc dua vao commit neu chua co yeu cau ro. Xem handoff moi nhat de lay dung ten file.
