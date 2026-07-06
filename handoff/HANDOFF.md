# HANDOFF 2026-07-06

Ban giao cho agent/session tiep theo.

## Trang thai moi nhat

- GitHub `main` va branch `codex/sensortower-zh-workspace` da duoc push len commit `d361592` trong phien nay; sau do co the co commit handoff docs moi hon, kiem tra `git log -1`.
- Worker production da deploy voi prompt taxonomy `v2`.
- Worker version da deploy trong phien nay: `e7a22579-4043-403a-8e05-6e86b5419bc8`.
- Pages production da deploy bang `npx wrangler pages deploy ./dist --project-name=cfl-feedback --branch main`.
- Pages preview/branch deploy da tao:
  - `https://7aeb5a8d.cfl-feedback.pages.dev`
  - `https://codex-sensortower-zh-workspa.cfl-feedback.pages.dev`
  - production deploy URL: `https://ad82038a.cfl-feedback.pages.dev`
- Health production da tra `status: ok`, `llm_provider: llm_viax`, `llm_ready: true`, `prompt_version: v2`.
- Production Pages `https://cfl-feedback.pages.dev` da verify HTTP 200.
- Cron Worker dang la `45 6 * * *`, tuc 13:45 GMT+7 moi ngay.
- Frontend local dang chay o `http://127.0.0.1:5175/`.
- User muon tu sau lam chinh tai `J:\My Drive\CFL\Agent\Tracking Store Social`, khong lam chinh tai `G:\CFM\Research\Crossfire Legends Sea` nua.
- Repo da clone sang `J:\My Drive\CFL\Agent\Tracking Store Social` tu GitHub branch `main`.

## Viec da lam trong phien gan nhat

- Chuan hoa UI Feedback Workspace/Ingest Settings, light/dark mode, Insight va Summarize.
- Them luu prompt insight, manual generate insight theo date range, archive insight.
- Them zh-CN translation pipeline va API fallback ngon ngu.
- Them Sensor Tower incremental cursor va cron 13:45 GMT+7.
- Them auto processing sau cron/ingest: classify + translate.
- Them taxonomy memory/subtopic discovery.
- Cap nhat keyword Chu De Lon va fallback classifier:
  - Keyword chung nam o `worker/src/services/topicKeywords.ts`.
  - Fallback classifier dung weighted keyword ranking.
  - Prompt LLM classify nhan keyword hints.
  - `PROMPT_VERSION` da bump len `v2`.
- Them repeated phrase detector cho Chu De Nho:
  - Ham `extractRepeatedSubtopicCandidates`.
  - Cum 2-4 tu lap lai >= 3 comment trong cung run se thanh subtopic candidate.
  - Tu qua chung nhu `lag`, `hack`, `bug` khong bi promote thanh subtopic rac.
- Them/cap nhat test cho fallback, taxonomy memory, routes, processing.

## Viec user yeu cau ket thuc phien nay

1. Push len GitHub.
2. Deploy len Cloudflare Worker va Pages.
3. Xoa cac Markdown khong can, chi giu:
   - `AGENT.md`
   - `MEMORY.md`
   - `handoff/*.md`
4. Clone repo sang:
   `J:\My Drive\CFL\Agent\Tracking Store Social`
5. Cap nhat prompt cho agent/session khac doc va lam tiep.

Trang thai cac viec tren: da thuc hien trong phien 2026-07-06. Neu tiep tuc, lam viec tu thu muc o o J va pull latest truoc.

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
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/comments?limit=1&lang=zh-CN"
```

## Viec tiep theo de tiep tuc phat trien

- Test UI production tren Cloudflare Pages sau deploy moi.
- Chay lai phan loai mot run cu neu muon data cu nhan taxonomy keyword `v2`.
- Neu Sensor Tower key moi da co, set `SENSORTOWER_API_KEY` bang `wrangler secret put`, sau do test manual ingest mot ngay nho.
- Neu user muon mo rong taxonomy, sua `worker/src/services/topicKeywords.ts` va them test truoc.

## Prompt cho agent/session khac

Hay doc theo thu tu: `AGENT.md`, `MEMORY.md`, `handoff/HANDOFF.md`. Day la project CFL Feedback Intelligence, backend production la Cloudflare Worker trong `worker/`, frontend la React/Vite trong `frontend/`, DB la Cloudflare D1 `cfl-feedback`. Tiep tuc lam viec tu thu muc `J:\My Drive\CFL\Agent\Tracking Store Social`. Khong tu nhap secret, khong them Markdown ngoai `AGENT.md`, `MEMORY.md`, `handoff/*.md`. Truoc khi bao xong phai chay test/build/deploy verify that.
