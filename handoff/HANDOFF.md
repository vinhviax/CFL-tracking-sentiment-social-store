# HANDOFF 2026-07-23

Ban giao cho agent/session tiep theo cua project **CFL Feedback Intelligence**.
(Handoff cu cua session Excel export 2026-07-20 nam o cuoi file, muc "## LICH SU cac session truoc".)

## Trang thai hien tai

- Workspace canonical (git repo): `J:\My Drive\CFL\Agent\Tracking Store Social` (branch `main`)
- Repo GitHub: `https://github.com/vinhviax/CFL-tracking-sentiment-social-store.git`
- Commit moi nhat da push: `339f836 Add source filter + pagination to ingest history`
  - Commit truoc do trong lich su: `1681f2d Add curated game-mode subtopics and subtopic filter to exports`
- Worker production: `https://cfl-feedback-worker.vinhviax.workers.dev`
- Pages production: `https://cfl-feedback.pages.dev`
- Pages deployment moi nhat: `dae607a4` (Environment=Production, Branch=main)
- Worker: **KHONG deploy trong session nay** (chi doi frontend). Route game-modes da co san tren production tu truoc.

Working tree J: sach, local va `origin/main` da dong bo.

> ⚠️ **Luu y ve nhieu ban clone**: co it nhat 3 cho chua source:
> - `J:\...\Tracking Store Social` = **canonical git, branch main** (nguon su that, edit o day).
> - `G:\CFM\Research\Crossfire Legends Sea` = clone CU, branch `codex/sensortower-zh-workspace`, **CHUA co game-modes / taxonomy moi** (dung `gameplay/matchmaking/...` cu). ĐUNG dung lam nguon.
> - `C:\Temp\cfl-export-20260720-1442` = ban copy local (khong-git) da `npm ci`, dung de build/test/deploy (vi node_modules tren Drive treo vitest). frontend/src cua no khop J: (da diff).

## Session nay lam gi

### A. Taxonomy game-mode + chay tag/verify tren production

Chu de con "Mode choi" nam trong chu de lon **`gameplay_mode_map`** (Che do choi/Map/Gameplay). 9 mode curated (parent_topic=`gameplay_mode_map`, key dang `gameplay_mode_map:<slug>`):
C4 Kinh Te, C4 Thuong, Zombie v4, Zombie Truy Kich, Dau Dao, Dau Sniper, Dau Doi, Dau Don, Tron Tim.

- Route: `POST /api/game-modes/tag` (worker `src/routes/gameModes.ts`, service `src/services/gameModeTagging.ts` + `gameModes.ts`). Params: `{from,to,verify,verify_batch_size,max_llm_batches,debug}`. **Idempotent** — chay lai an toan khi co data moi.
  - Buoc 1 keyword-only: match tu khoa → tag chac chan (source=`keyword` trong `comment_subtopics`).
  - Buoc 2 LLM verify: cac case mo ho (bare "c4"/"dat bom"/"solo"/"tdm"...) gui LLM theo batch, LLM tra JSON `{"results":[{"id":N,"modes":[...]}]}`. Tag confirmed co source=`keyword_llm`.
- **Da chay full 2 buoc tren production 2026-06-29→2026-07-23** (30.115 comment): keyword 553 + LLM verify (796 candidate → +258) = **811 tag**.
  per_mode: C4 Kinh Te 299, C4 Thuong 260, Tron Tim 84, Zombie Truy Kich 51, Dau Dao 51, Dau Doi 40, Dau Don 14, Dau Sniper 11, Zombie v4 1.
- Da verify precision bang du lieu that: C4 Kinh Te 299 = gop ca "kinh te"/"rank kinh te" (dung, nguoi choi goi tat); C4 Thuong 260 = cac cau "dat/go bom, leo c4" (dung). User da CHOT giu nguyen dinh nghia C4 Kinh Te (299).
- LLM tunnel `rpi7jss.abc-tunnel.us` (provider `llm_viax`) tung down (HTTP 530/1016) o session truoc, **da len lai** va tra dung format.

### B. UI Lich su Ingest: loc theo nguon + phan trang (commit 339f836)

File: `frontend/src/pages/IngestSettings.jsx` + `frontend/src/index.css`.
- Them segmented filter (pill co dem so): **Tat ca / Store / Fanpage / Group**. Map: Store=`store`, Fanpage=`fb_page`, Group=`facebook_csv`+`fb_group_csv`. Const `RUN_SOURCE_FILTERS` + `RUNS_PER_PAGE=50` khai bao dau file.
- `loadRuns`: `listRuns({ limit: 20 })` → **`limit: 500`** (truoc chi tai 20 run nen an cac run cu).
- Phan trang client-side 50 dong/trang (thanh Truoc/Sau chi hien khi >50). Chi 35 run ton tai nen thuong 1 trang.
- Da build + verify tren browser (filter Group hien dung run CSV #47 = data 29/06→06/07) + deploy Pages.

### C. Da giai dap (khong sua code)

- **"Comment 29/6-13/7 dau?"**: KHONG mat. 27.665 comment con nguyen trong DB, da phan tich. Chung den tu run CSV #47 (`facebook_csv`, 14.514 dong moi). Truoc day bi an vi frontend chi tai 20 run + run #1-46 da bi xoa (comment khong xoa theo). Nay filter Group thay ngay.
- **"Sao C4 Kinh Te tren web chi vai chuc?"**: vi workspace loc **Chu de chinh** (`a.topic_main`) GIAO voi Chu de con. Tag mode ton tai tren comment o NHIEU chu de chinh (rank, matchmaking, update...), nen "topic=Gameplay + subtopic=C4 Kinh Te" chi lay phan giao (~38 tren Fanpage). Muon xem DU 1 mode → dung dialog Xuat Excel (chon Chu de con, de Kieu=Tong quan, khong chon Chu de chinh) → filter subtopic doc lap voi topic_main.
  - User da tu choi (chon "Giu nguyen") viec tach subtopic filter doc lap tren workspace. **Neu sau nay muon**: backend da san sang (comments/stats/export deu EXISTS tren `comment_subtopics` doc lap topic); chi can bo `disabled={!filters.topic}` o dropdown Chu de con va cho phep chon subtopic ma khong set topic_main.

## Viec co the lam tiep (chua lam)

- **Zombie v4 chi 1 tag** — gan nhu thieu tu khoa (nguoi choi goi kieu khac: "zombie 4.0", "zb4", hoac chi "zombie"). Xin user vai cach goi thuc te → them keyword vao dinh nghia mode → chay lai `POST /api/game-modes/tag` (vai giay).
- Neu user doi y muon loc mode tren workspace: xem muc C tren.
- Chay `game-modes/tag` dinh ky khi co data moi (route idempotent).

## Gotcha quan trong (con hieu luc)

- **`node_modules` tren Google Drive (`J:`) lam vitest/npm treo vo han**. Quy trinh chuan: copy `worker/`+`frontend/` ra local (vd `C:\Temp\...`), `npm ci`, roi test/typecheck/build/deploy tu do. **Chi 2 file khac nhau giua J: va C:\Temp copy** thuong la file vua sua → co the copy de file do sang C:\Temp roi build (dung diff -rq de kiem tra truoc khi build/deploy tranh revert nham).
- **Pages la direct-upload (khong noi git)**: `npx wrangler pages deploy ./dist --project-name=cfl-feedback` tu thu muc non-git van tao deployment Environment=Production/Branch=main. Sau deploy alias `cfl-feedback.pages.dev` co the con phuc vu bundle cu vai giay (CDN cache) → Ctrl+F5 / them `?_cb=`.
- Frontend la **hash router**: trang Ingest o `#/ingest` (khong phai `/ingest`). Preview local: `npx vite preview --port <p>` roi mo `http://localhost:<p>/#/ingest`. Browser pane screenshot co the fail neu pane an → dung `read_page` (text) de verify.
- `/api/export` GET co the bi edge-cache → dung cache-buster rieng moi request khi smoke test.
- **D1**: gioi han bound parameter thap (chunk IN-clause ~90). `xlsx` phai cai tu `cdn.sheetjs.com` (CVE tren npm registry) — xem `worker/package.json`.
- **Git tren checkout Drive**: `git fsck` in nhieu "bad sha1 file" du exit 0 — KHONG tu sua/xoa object. `status`/`log`/`commit`/`push main` chay binh thuong. `git commit` canh bao LF→CRLF la binh thuong tren Windows.

## Cau hinh LLM (khong doi trong session nay)

- Insight/HTML Report: `codex-lb/gpt-5.6-terra` (`LLM_INSIGHT_MODEL`).
- `reasoning` (phan tich comment, taxonomy/subtopic, game-mode verify): override D1 → `custom` → `codex-lb/gpt-5.6-terra`.
- `simple` (dich zh-CN): default `ag/gemini-3-flash-agent` qua provider `llm_viax`.

## Lenh nhanh

Production smoke:
```powershell
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/health"
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/ingest/status"
```

Chay lai tag game-mode (idempotent):
```
POST https://cfl-feedback-worker.vinhviax.workers.dev/api/game-modes/tag
body: {"from":"2026-06-29","to":"2026-07-23","verify":true,"verify_batch_size":40}
```

Quy trinh verify/deploy frontend chuan:
```powershell
$C = "C:\Temp\cfl-export-20260720-1442"   # ban copy da npm ci; frontend/src khop J:
# 1. sua o J: (canonical) -> 2. copy file da sua sang $C\frontend\src -> 3. build
cd "$C\frontend"; npm run build
# 4. verify: npx vite preview --port 4319 ; mo http://localhost:4319/#/ingest ; read_page
# 5. deploy: npx wrangler pages deploy ./dist --project-name=cfl-feedback
# 6. commit + push o J:
```

---

## LICH SU cac session truoc

### Session 2026-07-20: tinh nang Xuat Excel comment

Them chuc nang xuat comment ra Excel theo nguon + khoang thoi gian + chu de (commit `bf5f2f7..d6158bb`). Backend: helper chung `worker/src/services/commentFilters.ts` (`buildCommentFilters`) cho ca `/api/comments` va `/api/export`; `/api/export` nhan `sources` (csv list) → moi nguon 1 sheet; them cot Quoc gia / Cho ung dung / Link post FB; `MAX_EXPORT_ROWS=50000` (tra 413 neu vuot). Frontend: `ExcelExportDialog` trong `FeedbackWorkspace.jsx` (multi-select nguon, ghi chu ngay data moi nhat, chon chu de, khoang ngay). Da deploy + verify production. Tests: `commentFilters.test.ts`, `export.test.ts`, `FeedbackWorkspace.ui.test.js`.
