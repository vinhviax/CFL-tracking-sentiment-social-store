# HANDOFF 2026-07-07

Ban giao cho agent/session tiep theo cua project **CFL Feedback Intelligence**.

## Trang thai hien tai

- Workspace dang lam: `J:\My Drive\CFL\Agent\Tracking Store Social`.
- Repo GitHub: `https://github.com/vinhviax/CFL-tracking-sentiment-social-store.git`.
- Branch: `main`.
- Code deploy commit: `0669ef4 Add game comparison taxonomy and liveops prompts`.
- Git working tree sau deploy duoc cap nhat them handoff/memory de ghi trang thai production moi.
- Worker production: `https://cfl-feedback-worker.vinhviax.workers.dev`.
- Pages production: `https://cfl-feedback.pages.dev`.
- Latest Worker deploy version: `d5575ee4-f98f-4315-bb25-5df5e1467a3e`.
- Latest Pages deploy URL: `https://9ab378d0.cfl-feedback.pages.dev`.
- Production health da verify sau deploy: `/api/health` tra `status: ok`, `llm_provider: llm_viax`, `llm_ready: true`, `prompt_version: v4`.

## Deploy/verify vua chay

- Commit/push moi nhat: `0669ef4 Add game comparison taxonomy and liveops prompts`.
- Worker deploy bang checkout verify:
  `C:\Users\CPU13114\AppData\Local\Temp\cfl-feedback-worker-verify`.
- Worker full tests: 26 test files pass, 96 tests pass.
- Sau update prompt liveops: worker full tests pass 26 files / 96 tests, `npm run typecheck` pass trong `C:\Users\CPU13114\AppData\Local\Temp\cfl-feedback-worker-verify\worker`.
- Worker typecheck: pass.
- Frontend build: pass; Vite van co warning cu ve chunk lon hon 500 kB.
- Pages deploy thanh cong; Cloudflare bao 0 file upload moi vi frontend asset khong doi.
- `https://cfl-feedback.pages.dev` tra HTTP 200.

## Nhung thay doi da xong trong loat lam viec nay

1. Hang doi xu ly Ingest & Cai Dat
   - Sau khi keo/upload data, he thong tu xep hang classify roi translate zh-CN.
   - Hang doi xu ly duoc luu D1, khong phu thuoc tab UI dang mo.
   - Nhieu task co the cho/chay theo queue, khong de nut translate/classify moi de len task cu.
   - Co nut huy task dang cho/dang chay/bi loi.
   - Task da xong tu an khoi hang doi.
   - Log LLM theo batch hien trong task, co batch started/completed/failed.

2. LLM processing
   - Co cau hinh LLM Agent: default worker hoac custom OpenAI-compatible provider/key/endpoint/model.
   - Tach model don gian cho translate va model suy luan/cao hon cho analysis.
   - Batch LLM chay song song theo config `LLM_BATCH_CONCURRENCY`.
   - Da fix loi JSON translation malformed: parser tolerant hon, khong fail ca job neu model tra JSON thieu dau phay/dau ngoac.
   - UI rut gon ten model trong log va drawer comment, bo prefix nhu `codex-lb/`, chi hien phan model can doc.

3. Taxonomy v3
   - Da tach chi tiet topic lon, dac biet:
     `lag_fps`, `crash_freeze`, `network_ping`.
   - Topic list hien tai:
     `lag_fps`, `crash_freeze`, `network_ping`, `login_account`, `account_ban_security`, `payment_topup`, `purchase_delivery`, `update_download`, `ui_control`, `gameplay_mode_map`, `shooting_mechanics`, `matchmaking`, `rank_competition`, `balance`, `hack_cheat`, `event_mission`, `reward_giftcode`, `gacha_rate`, `item_skin_weapon`, `social_chat_voice`, `community_behavior`, `customer_support`, `feature_request`, `content_esports`, `spam_ads_scam`, `positive_feedback`, `technical_other`, `other`.
   - Prompt version production hien la `v4`.
   - Da them topic `game_comparison` / `So Sánh Game` va bump prompt version len `v4`; da commit/push/deploy trong commit `0669ef4`.
   - Topic `game_comparison` bat comment nhac toi CFM, CrossFire Mobile, ban Trung/China, ban SEA, ban Viet/VN, global/quoc te hoac game khac lien quan, ke ca khi khong so sanh truc tiep.

4. CSV Facebook Group
   - Parser doc dung 5 cot A-E:
     Source, Post Published Date, Post Message, Created Date, Comment Message.
   - Chi nhap dong co Source = `Group`, bo qua dong khac.
   - Luu context post goc (`posts`) de comment biet no tra loi bai post nao.
   - Preview CSV hien du 5 cot, range ngay cua dong Group.
   - Dedupe hash co them context post de tranh trung comment cung text nhung khac post.
   - Fix D1 SQL variable limit cho dedupe query bang chunk nho.
   - Fix moi nhat: insert CSV Group dung batch 100 rows de tranh Worker loi `Too many API requests by single Worker invocation` voi file 16.550 dong.

5. Store/Fanpage date va status
   - Toan bo UI input/label date da uu tien dd/mm/yyyy.
   - Ingest Settings co dong status moi nhat cho Store, Fanpage, Group CSV.
   - Fanpage latest status dung data date that, khong lay ngay run/start_at.
   - Store Sensor Tower fix parse/source date va UI run scope de uu tien requested range.
   - Luu y: run Store cu da import truoc fix co the van co data date cu trong D1; neu user muon sach hoan toan thi xoa run cu va keo lai.

6. Dashboard Feedback
   - Facebook tab co filter Fanpage/Group.
   - Comment detail drawer hien bai post goc va link mo post neu co.
   - Topic/subtopic filters dung taxonomy moi.
   - Da them semantic grouping cho subtopic: cac bien the update nhu `nhat xong`, `cap nhat xong`, `phien ban moi`, `cap nhat moi` duoc gom ve `Cập nhật/phiên bản mới`; API ranking/filter dung alias keys de chon mot nhom van loc du comment cu. Da commit/push/deploy.

7. Prompt liveops (da deploy)
   - `worker/src/services/llm/classifier.ts`: classifier prompt duoc nang thanh senior liveops analyst, yeu cau doc hieu comment/context/rating, khong keyword-only, chon issue driver, rule ro cho `game_comparison` / `So Sánh Game` khi nhac CFM/China/SEA/ban Viet/global/game khac.
   - `worker/src/services/translation.ts`: translation prompt dich zh-CN cho product/liveops/QA operators, giu technical meaning, severity va thuat ngu CFL/CFM/SEA/China.
   - `worker/src/services/taxonomyMemory.ts`: taxonomy memory prompt yeu cau gop semantic duplicate, khong tao subtopic chi vi n-gram/cum text lap; vi du update variants gom ve `Cập nhật/phiên bản mới`.

## Luu y ky thuat quan trong

- Khong nhap/log/commit secret. Neu can set key, huong dan user chay `wrangler secret put`.
- Worker node_modules trong workspace Google Drive co the hong/0-byte; neu test/deploy worker nen dung checkout verify:
  `C:\Users\PC\AppData\Local\Temp\cfl-feedback-verify-4a4fb46f900f4dd39b057f5b58dcf10b`.
- Khi sua CSV D1, nho 2 gioi han rieng:
  - SELECT `IN (...)` la mot SQL statement, phai giu bound variables thap. Hien dedupe lookup: 45 rows/chunk x 2 hash = 90 variables.
  - INSERT dung `db.batch` gom nhieu statement, nen batch khong nen qua nho. Hien post/comment insert: 100 rows/batch de giam D1 subrequest.
- PowerShell `ConvertTo-Json` co the hien UTF-8 bi mojibake tren console; khong ket luan API loi encoding neu UI van dung.
- Chi commit/push/deploy khi user noi ro; user da nhac khong tu deploy moi lan sua.

## Viec co the lam tiep o cong ty

1. Cho user upload lai file CSV Group 16.550 dong tren production de verify loi `Too many API requests...` da het.
2. Neu upload van cham/loi do thoi gian request, can tach CSV ingest thanh job/chunk async thay vi lam het trong mot request HTTP.
3. Neu user muon Store run cu hien dung ngay 06/07/2026, can xac nhan co xoa run cu va keo lai hay migration/repair data D1.
4. Kiem tra LLM custom provider: loi 403 model not allowed la do key/model cua provider custom, khong phai worker default.
5. Neu can tiep tuc refine dashboard Facebook, uu tien hien ro comment thuoc post nao trong table/list, khong chi trong drawer.

## Lenh nhanh

Worker verify/deploy:

```powershell
$verifyRoot = 'C:\Users\PC\AppData\Local\Temp\cfl-feedback-verify-4a4fb46f900f4dd39b057f5b58dcf10b'
git -C $verifyRoot fetch origin main
git -C $verifyRoot reset --hard origin/main
Push-Location "$verifyRoot\worker"
npm test
npm run typecheck
npx wrangler deploy
Pop-Location
```

Frontend build/deploy:

```powershell
$verifyRoot = 'C:\Users\PC\AppData\Local\Temp\cfl-feedback-verify-4a4fb46f900f4dd39b057f5b58dcf10b'
Push-Location "$verifyRoot\frontend"
npm run build
npx wrangler pages deploy ./dist --project-name=cfl-feedback
Pop-Location
```

Production smoke:

```powershell
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/health"
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/meta"
Invoke-WebRequest "https://cfl-feedback.pages.dev" -UseBasicParsing
```
