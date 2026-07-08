# HANDOFF 2026-07-08

Ban giao cho agent/session tiep theo cua project **CFL Feedback Intelligence**.

## Trang thai hien tai

- Workspace: `J:\My Drive\CFL\Agent\Tracking Store Social`
- Repo GitHub: `https://github.com/vinhviax/CFL-tracking-sentiment-social-store.git`
- Branch: `main`
- Commit moi nhat da push: `4340b9a feat: add detailed issue breakdown to reports`
- Worker production: `https://cfl-feedback-worker.vinhviax.workers.dev`
- Pages production: `https://cfl-feedback.pages.dev`
- Worker deploy version moi nhat: `ae733667-7b3e-4c50-840e-2d4653f171c7`
- Pages deploy moi nhat: `https://0074bf06.cfl-feedback.pages.dev`

## Thay doi moi nhat

Da bo sung co che lam ro insight/report theo tung van de cu the trong moi chu de.

- Prompt Insight and Summarize bay gio bat buoc khong viet chung chung theo chu de cha.
- Khi overview co `top_subtopics`, prompt se dua vao LLM danh sach "Chi tiet van de trong tung chu de" gom:
  - Chu de cha
  - Van de cu the/subtopic
  - Tong comment
  - So comment tieu cuc
  - So comment khan cap
- HTML report co them section `Chi tiet van de user nhac toi`.
- Section moi lay tu `subtopic_ranking`, bo `Khac/Khong du ngu canh`, va sort theo uu tien:
  1. Khan cap
  2. Tieu cuc
  3. Volume
- Muc tieu: report khong chi ghi kieu "Loi Game" hoac "Lag/FPS", ma phai boc tach ro user dang noi loi gi, vi du login stuck, crash/vang game, khong vao tran, drop FPS trong combat, tai nguyen/cap nhat loi, kem count tung nhom.

Files chinh da sua:

- `worker/src/services/insights.ts`
- `worker/src/services/insights.test.ts`
- `worker/src/services/reportHtml.ts`
- `worker/src/services/reportHtml.test.ts`

## Verify da chay

Do `node_modules` trong workspace chinh tren Google Drive co loi khi goi TypeScript binary, worker duoc verify trong temp checkout:

`C:\Users\CPU13114\AppData\Local\Temp\cfl-feedback-verify-20260707214814`

Ket qua:

- Focused worker tests cho `insights` va `reportHtml`: pass.
- Full worker tests: pass `29/29 test files`, `125/125 tests`.
- Worker typecheck: pass.
- Frontend build: pass, chi con Vite warning cu ve chunk lon hon 500 kB.
- Worker health production: `/api/health` tra `status: ok`, `llm_provider: llm_viax`, `llm_ready: true`, `prompt_version: v4`.
- Production Pages `https://cfl-feedback.pages.dev/?v=4340b9a` tra HTTP 200.

## Deploy da chay

Worker:

```powershell
cd C:\Users\CPU13114\AppData\Local\Temp\cfl-feedback-verify-20260707214814\worker
npx wrangler deploy
```

Ket qua:

- URL: `https://cfl-feedback-worker.vinhviax.workers.dev`
- Version ID: `ae733667-7b3e-4c50-840e-2d4653f171c7`

Pages:

```powershell
cd C:\Users\CPU13114\AppData\Local\Temp\cfl-feedback-verify-20260707214814\frontend
npm run build
npx wrangler pages deploy ./dist --project-name=cfl-feedback
```

Ket qua:

- Preview deployment: `https://0074bf06.cfl-feedback.pages.dev`
- Production domain smoke: `https://cfl-feedback.pages.dev/?v=4340b9a` HTTP 200

## Git status can chu y

Truoc va sau task nay van co 2 file Demo Report dang staged san, khong phai thay doi cua task issue-detail va khong duoc dua vao commit neu user khong yeu cau:

- `Demo Report/CFL_Monthly_Social_Sentiment_Store_Review_Thang_2026_06 ver 3.html`
- `Demo Report/CFL_Social Sentiment Update 4.0 - 7D.html`

Khi commit tiep, dung command kieu:

```powershell
git commit --only -m "message" -- <paths>
```

de tranh gom nham 2 file nay.

## Lenh nhanh

Production smoke:

```powershell
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/health"
Invoke-WebRequest "https://cfl-feedback.pages.dev/?v=4340b9a" -UseBasicParsing
```

Neu can deploy lai worker tu temp verify:

```powershell
$verifyRoot = 'C:\Users\CPU13114\AppData\Local\Temp\cfl-feedback-verify-20260707214814'
Push-Location "$verifyRoot\worker"
npm test
npm run typecheck
npx wrangler deploy
Pop-Location
```

Neu can deploy lai frontend tu temp verify:

```powershell
$verifyRoot = 'C:\Users\CPU13114\AppData\Local\Temp\cfl-feedback-verify-20260707214814'
Push-Location "$verifyRoot\frontend"
npm run build
npx wrangler pages deploy ./dist --project-name=cfl-feedback
Pop-Location
```
