# HANDOFF 2026-07-06

Ban giao cho agent/session tiep theo.

## Trang thai moi nhat

- Lam viec chinh tai `J:\My Drive\CFL\Agent\Tracking Store Social`.
- Repo GitHub: `https://github.com/vinhviax/CFL-tracking-sentiment-social-store.git`.
- Branch lam viec hien tai: `main`.
- Backend production la Cloudflare Worker trong `worker/`.
- Frontend production la React/Vite trong `frontend/`, deploy Cloudflare Pages.
- Database production la Cloudflare D1 `cfl-feedback`.
- Worker production: `https://cfl-feedback-worker.vinhviax.workers.dev`.
- Frontend production: `https://cfl-feedback.pages.dev`.
- Cron Worker dang la `45 6 * * *`, tuc 13:45 GMT+7 moi ngay.
- LLM provider production dang cau hinh `llm_viax`; classify model `ag/gemini-3-flash-agent`; insight model `codex-lb/gpt-5.4`.
- Neu can commit/deploy moi, chay test/build/typecheck truoc, sau do commit, push, deploy Worker, deploy Pages va verify production.

## Viec da lam trong phien nay

- Feedback Workspace Store da co diem rating trung binh va highlight theo khoang thoi gian dang filter.
- Label UI da chuyen sang tieng Viet: `neg` thanh tieu cuc, `urgent` thanh khan cap.
- Filter Feedback Workspace da gom thanh mot hang gon hon, co nut reset filter.
- Filter da co logic phu thuoc: Sentiment -> Chu de lon -> Chu de con, tranh tron topic cua cac sentiment khac nhau.
- UI theme da doi huong: dark mode tone den/cam, light mode tone trang/cam am.
- Ingest Settings gom cac nut hanh dong trong cung mot hang de tiet kiem dien tich.
- Manual ingest CSV/Fanpage/Store sau khi keo data thanh cong se tu xep hang classify -> taxonomy memory/subtopic -> translate zh-CN. Nut phan tich/dich trong UI chi de chay lai khi can.
- CSV Facebook Group chi nhap dong co cot A/source = `Group`; dong Fanpage trong file CSV bi bo qua.
- Upload CSV bi chan neu file khong co dong Group hop le hoac toan duplicate voi data da co.
- Da kiem tra production read-only cho ingest #1 va #7: #1 co ca `fb_group_csv` va `fb_page`, #7 la `fb_page`, khong thay overlap duplicate giua #1 va #7 theo hash hoac created_at + message.
- Ingest Settings co nut xoa tung ingest run. Backend xoa comments/analyses/translations/subtopics/memory/progress jobs lien quan truoc khi xoa run.
- Da them/cap nhat test cho stats Store, helper filter UI, CSV guardrail/duplicate, auto enqueue sau ingest va delete ingest run.

## Luu y quan trong

- Khong tu nhap, log, commit hay paste secret. Neu can key, huong dan user tu chay `wrangler secret put <NAME>`.
- Khong them Markdown ngoai `AGENT.md`, `MEMORY.md`, `handoff/*.md`.
- Khong xoa/revert thay doi cua user neu chua duoc yeu cau ro.
- Khi user tu tay xoa data production va keo lai, can verify lai dashboard Store/Facebook/Feedback Workspace va lich su ingest.
- Neu user hoi LLM `auto` loi nhung `default` thanh cong, uu tien kiem tra request/timeout/model routing; khong doi secret hay log key.

## Viec nen verify sau khi pull/clone

```powershell
cd "J:\My Drive\CFL\Agent\Tracking Store Social"
cd worker
npm test
npm run typecheck
cd ..\frontend
npm run build
```

Sau deploy, verify:

```powershell
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/health"
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/meta"
Invoke-WebRequest "https://cfl-feedback.pages.dev"
```

## Viec tiep theo de tiep tuc phat trien

- Sau khi user xoa ingest cu va keo data lai, test luong: upload CSV Group -> auto classify -> auto translate -> xem topic/subtopic/filter.
- Verify nut xoa ingest tren production bang mot run test nho, tranh xoa nham run that.
- Kiem tra lai UI mobile/desktop sau deploy Pages.
- Neu LLM auto con loi `client_disconnected`, xem log Cloudflare/LLM gateway va can nhac chi dung model default trong config neu user muon.

## Prompt cho agent/session khac

Doc theo thu tu `AGENT.md`, `MEMORY.md`, `handoff/HANDOFF.md` truoc khi lam gi. Day la project CFL Feedback Intelligence. Lam chinh tai `J:\My Drive\CFL\Agent\Tracking Store Social`. Backend production la Cloudflare Worker trong `worker/`, frontend la React/Vite trong `frontend/`, DB la Cloudflare D1 `cfl-feedback`. Khong tu nhap/log/commit secret. Khong them Markdown ngoai `AGENT.md`, `MEMORY.md`, `handoff/*.md`. Luu y moi: CSV Facebook Group chi nhap dong source/cot A = `Group`; upload toan duplicate hoac khong co Group bi tu choi truoc khi tao ingest run. Manual ingest se tu xep hang classify -> taxonomy memory/subtopic -> translate zh-CN. Ingest Settings co nut xoa run; xoa run se xoa comments/analyses/translations/subtopics/memory/progress jobs lien quan. Truoc khi bao xong phai chay test/build/typecheck va neu deploy thi verify production. Viec nen lam tiep: sau khi user xoa data production va keo lai, verify dashboard Store/Facebook/Feedback Workspace, test nut xoa ingest voi run nho, va xem LLM auto/default neu con loi.
