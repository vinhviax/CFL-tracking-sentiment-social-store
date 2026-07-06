# HANDOFF 2026-07-07

Ban giao cho agent/session tiep theo.

## Trang thai moi nhat

- Workspace chinh trong session nay: `G:\My Drive\CFL\Agent\Tracking Store Social`.
- Checkout phu dung de verify vi `node_modules` trong Google Drive bi ghi thanh file 0 byte: `C:\Users\PC\Documents\Codex\2026-07-07\files-mentioned-by-the-user-handoff\work\CFL-tracking-sentiment-social-store`.
- Repo GitHub: `https://github.com/vinhviax/CFL-tracking-sentiment-social-store.git`.
- Branch lam viec hien tai: `main`, dang o `main...origin/main`.
- Backend production la Cloudflare Worker trong `worker/`.
- Frontend production la React/Vite trong `frontend/`, deploy Cloudflare Pages.
- Database production la Cloudflare D1 `cfl-feedback`.
- Worker production: `https://cfl-feedback-worker.vinhviax.workers.dev`.
- Frontend production: `https://cfl-feedback.pages.dev`.
- Cron Worker dang la `45 6 * * *`, tuc 13:45 GMT+7 moi ngay.
- LLM provider production dang cau hinh `llm_viax`; classify model `ag/gemini-3-flash-agent`; insight model `codex-lb/gpt-5.4`.
- Chua commit, chua push, chua deploy cac thay doi moi ngay 2026-07-07.

## Thay doi moi

- User yeu cau lich su ingest ghi ro data that duoc keo/nhap tu ngay nao toi ngay nao cho Store/Fanpage/CSV Group.
- Da them `data_start_date` va `data_end_date` vao response `GET /api/runs` va `GET /api/runs/:id`, tinh truc tiep tu `comments.created_at` theo tung `ingest_run_id`.
- Cach lam khong can migration DB vi range la field tinh toan tu comments hien co.
- UI Ingest Settings uu tien hien `Dữ liệu: <ngay dau> -> <ngay cuoi>` neu run co `data_start_date` / `data_end_date`.
- Neu run khong co comment date thi UI fallback ve note cu: `Yêu cầu kéo: ...`, filename, hoac ngay keo.
- CSV preview tu tinh khoang ngay dau/cuoi cua cac dong `Group` hop le va hien trong phan xem truoc upload.
- CSV upload tra them range cua cac dong `Group` moi duoc import.
- Parser CSV date chap nhan them dinh dang ISO `YYYY-MM-DD...` ngoai dinh dang VN `D/M/YYYY`.

## File dang thay doi chua commit

- `worker/src/routes/runs.ts`
- `worker/src/routes/runs.test.ts`
- `worker/src/routes/ingest.ts`
- `worker/src/routes/ingest.test.ts`
- `worker/src/services/csvIngest.ts`
- `worker/src/services/csvIngest.test.ts`
- `frontend/src/pages/IngestSettings.jsx`
- `frontend/src/pages/IngestSettings.ui.test.js`
- `handoff/HANDOFF.md`

## Kiem chung da chay

Trong workspace chinh `G:\My Drive\...`, `node_modules` cua Worker/Frontend bi loi file 0 byte sau `npm ci`, nen cac lenh npm/vitest/tsc khong dang tin o workspace nay.

Da verify tren checkout phu co diff 8 file code/test trung exact voi workspace chinh:

- Worker targeted test: `npm test -- src/routes/runs.test.ts src/routes/ingest.test.ts src/services/csvIngest.test.ts`
  - Ket qua: 3 file test pass, 14 test pass.
- Worker full test: `npm test`
  - Ket qua: 14 file test pass, 37 test pass.
- Worker typecheck: `npm run typecheck`
  - Ket qua: pass.
- Frontend focused tests: `node --test src/pages/FeedbackWorkspace.helpers.test.js src/pages/IngestSettings.ui.test.js`
  - Ket qua: 9 test pass.
- Frontend build: `npm run build`
  - Ket qua: pass, van co warning cu cua Vite ve chunk > 500 kB.
- Trong workspace chinh, da chay duoc `node --test src/pages/IngestSettings.ui.test.js`
  - Ket qua: 5 test pass.
- `git diff --check`
  - Ket qua: pass; chi co warning LF se duoc thay bang CRLF khi Git cham file.

## Luu y quan trong

- Khong tu nhap, log, commit hay paste secret. Neu can key, huong dan user tu chay `wrangler secret put <NAME>`.
- Khong them Markdown ngoai `AGENT.md`, `MEMORY.md`, `handoff/*.md`.
- Khong xoa/revert thay doi cua user neu chua duoc yeu cau ro.
- Khi deploy production, chay test/build/typecheck truoc, commit ro noi dung, push, deploy Worker, deploy Pages va verify production endpoints.
- Neu user muon verify production voi data that, uu tien read-only truoc. Chi xoa ingest run production khi user chi ro run test nao duoc xoa.
- PowerShell co the hien thi UTF-8 bi mojibake khi `ConvertTo-Json`; khong mac dinh ket luan API loi encoding.

## Viec tiep theo

- Neu user dong y, commit thay doi range ingest history, push len `main`, deploy Worker va Pages.
- Sau deploy, verify production:

```powershell
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/health"
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/meta"
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/runs?limit=3"
Invoke-WebRequest "https://cfl-feedback.pages.dev"
```

- Sau khi user xoa ingest cu va keo lai, test luong: upload CSV Group -> preview hien range Group -> upload -> auto classify -> auto translate -> lich su ingest hien range data -> xem topic/subtopic/filter.
- Verify nut xoa ingest tren production bang mot run test nho, tranh xoa nham run that.
- Neu LLM auto con loi `client_disconnected`, xem log Cloudflare/LLM gateway va can nhac chi dung model default trong config neu user muon.

## Prompt cho agent/session khac

Doc theo thu tu `AGENT.md`, `MEMORY.md`, `handoff/HANDOFF.md` truoc khi lam gi. Day la project CFL Feedback Intelligence. Backend production la Cloudflare Worker trong `worker/`, frontend la React/Vite trong `frontend/`, DB la Cloudflare D1 `cfl-feedback`. Khong tu nhap/log/commit secret. Khong them Markdown ngoai `AGENT.md`, `MEMORY.md`, `handoff/*.md`. Thay doi chua commit: lich su ingest va CSV preview da co `data_start_date`/`data_end_date` tinh tu comment date; UI hien `Dữ liệu: ngay dau -> ngay cuoi`. Truoc khi bao xong phai chay test/build/typecheck; neu deploy thi verify production.
