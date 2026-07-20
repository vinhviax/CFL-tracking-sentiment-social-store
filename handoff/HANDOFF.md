# HANDOFF 2026-07-20

Ban giao cho agent/session tiep theo cua project **CFL Feedback Intelligence**.

## Trang thai hien tai

- Workspace: `J:\My Drive\CFL\Agent\Tracking Store Social`
- Repo GitHub: `https://github.com/vinhviax/CFL-tracking-sentiment-social-store.git`
- Branch: `main`
- Commit moi nhat da push: `d6158bb Add demo social sentiment report exports`
- Worker production: `https://cfl-feedback-worker.vinhviax.workers.dev`
- Pages production: `https://cfl-feedback.pages.dev`
- Worker deploy version moi nhat: `f48b3d7c-a161-4d86-9c9c-ddc9f8e7e41b`
- Pages deployment moi nhat: `979191bd` (Environment=Production, Branch=main)

Working tree sach, local va `origin/main` da dong bo.

## Thay doi trong session nay: tinh nang Xuat Excel comment

Them chuc nang xuat comment ra Excel theo nguon + khoang thoi gian + chu de. Da build, test, deploy va verify tren production. 3 commit da push (`bf5f2f7..d6158bb`):

- `0b3b099` — nut Xuat Excel ban dau (link truc tiep theo tab dang mo).
- `3f45ddd` — nang cap thanh popup dialog day du.
- `d6158bb` — 2 file Demo Report HTML (truoc day dang staged, user yeu cau commit not).

### Backend (`worker/`)

- Moi: `worker/src/services/commentFilters.ts` — helper `buildCommentFilters(q)` build chung menh de WHERE cho ca route `/api/comments` va `/api/export`, dam bao file Excel khop dung voi list comment tren UI. Ho tro: `source`, `sources` (list, csv), `group` (store/facebook), `store` (gp/ios), `q` (search), `from`/`to` (loc theo ngay bang `substr`), `topic`, `subtopic`, `sentiment`, `urgency`, `post_id`. Export `EXPORTABLE_SOURCE_TYPES = [store, fb_page, fb_group_csv]` va `parseSourceTypes`.
- `worker/src/routes/comments.ts`: refactor GET / dung `buildCommentFilters` (da bo cac ham local `dateKey`/`addDateFilter`/`parseSubtopicKeys`).
- `worker/src/routes/export.ts`: nhan `sources` (list) → moi nguon 1 sheet rieng trong cung 1 workbook (sheet names: Store / Fanpage / Group). Fallback legacy `group`/`source` van chay. Them cot **Quoc gia**, **Cho ung dung** (gp→Google Play, ios→App Store), **Link post Facebook**. Ten file theo nguon chon: `CFL_Comments_<All|Store|Fanpage|Group|Store-Fanpage|...>_<from>-<to>.xlsx`. Cap `MAX_EXPORT_ROWS=50000` (dem tong tren tat ca nguon truoc khi build, tra 413 neu vuot). Worker build file trong RAM nen day la guard chong OOM.
- Test moi: `commentFilters.test.ts`, `export.test.ts`.

### Frontend (`frontend/`)

- `frontend/src/pages/FeedbackWorkspace.jsx`: nut header "Xuat Excel" gio mo `ExcelExportDialog` (thay vi link truc tiep). Dialog co: checkbox multi-select 3 nguon (mac dinh tick het, chan tai neu bo het), ghi chu "Comment moi nhat dang co toi ngay:" lay tu `getIngestStatus()` (`/api/ingest/status`, field `source_status[].latest_data_date`), chon chu de (Tong quan / Theo chu de + chip, tai dung pattern cua ReportExportDialog), va khoang ngay from/to. Nut Tai Excel build `exportUrl({ sources, from, to, topic })`.
- `frontend/src/index.css`: style `.excel-source-picker`, `.excel-source-option`, `.excel-no-source`.
- Labels song ngu vi + zh-CN. Ngon ngu noi dung Excel: chi tieng Viet (user chon), khong co selector ngon ngu.
- UI test: `FeedbackWorkspace.ui.test.js` da cap nhat cho dialog.

## Verify va deploy da chay

Vi `node_modules` tren Google Drive KHONG on dinh (vitest treo vo han khi chay truc tiep tu `J:\...`), da copy source ra local de test + deploy:

`C:\Temp\cfl-export-20260720-1442\{worker,frontend}` (da `npm ci`).

Ket qua:

- Worker full tests: `32 test files`, `141/141 tests` pass. Typecheck pass.
- Frontend UI tests (`node --test` tren source, chay duoc truc tiep tren Drive): `8/8` pass.
- Worker deploy: version `f48b3d7c-...`. Bindings nguyen ven (LLM_INSIGHT_MODEL=codex-lb/gpt-5.6-terra, provider llm_viax, ...).
- Pages: build `vite build` (dung `.env.production` → `VITE_API_BASE=https://cfl-feedback-worker.vinhviax.workers.dev`), deploy `npx wrangler pages deploy ./dist --project-name=cfl-feedback`.
- Smoke test production: `/api/export?sources=store,fb_page,fb_group_csv&from=...&to=...` → file 3 sheet (Store 438 / Fanpage 8827 / Group 12147 dong voi khoang 2026-07-01..07). Ten file dung cho moi to hop nguon. `subtopic=%20` → 400. Row cap → 413.
- Verify UI tren browser: mo dialog tren `cfl-feedback.pages.dev`, ghi chu ngay hien dung (Store 16/07, Fanpage 20/07, Group 06/07), href nut Tai Excel dung.

## Gotcha quan trong (con hieu luc)

- **`node_modules` tren Google Drive treo vitest**: LUON copy `worker/` + `frontend/` ra thu muc local (vd `C:\Temp\...`), `npm ci`, roi test/deploy tu do. Frontend UI test kieu `node --test` (regex tren source) van chay duoc truc tiep tren Drive.
- **Pages deploy tu thu muc khong-git van vao Production/main**: chay `wrangler pages deploy ./dist --project-name=cfl-feedback` tu `C:\Temp\...` (khong phai git repo) van tao deployment Environment=Production, Branch=main. Sau deploy alias `cfl-feedback.pages.dev` co the con phuc vu bundle cu vai giay do CDN cache — them cache-buster (`?_cb=...`) hoac doi chut la cap nhat.
- **Edge cache tren `/api/export`**: response GET co the bi cache o edge; khi smoke test nhieu URL gan nhau, dung cache-buster rieng cho tung request (`_cb=$(date +%s%N)`) neu khong ten file/ket qua co the tra ve ban cu.
- **Git**: dung `git commit --only -- <paths>` khi can loai tru file dang staged khong lien quan. `git fsck` tren checkout Drive in nhieu dong `bad sha1 file` du exit 0 — KHONG tu sua/xoa object; clone ra local neu can repair. `git status`/`log`/`push main` van chay binh thuong.
- **D1**: gioi han bound parameter thap (chunk IN-clause o ~90). `xlsx` phai cai tu `cdn.sheetjs.com` (CVE tren npm registry) — xem `worker/package.json`.

## Cau hinh LLM (khong doi trong session nay)

- Insight va HTML Report: `codex-lb/gpt-5.6-terra` qua `LLM_INSIGHT_MODEL`.
- `reasoning` (phan tich comment, taxonomy/subtopic): override D1 bat, `custom` → `codex-lb/gpt-5.6-terra`.
- `simple` (dich zh-CN): override D1 luu `custom` → `codex-lb/gpt-5.6-luna` nhung `enabled=false`; dich thuc te chay default `ag/gemini-3-flash-agent` qua `llm_viax`.

## Lenh nhanh

Production smoke:

```powershell
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/health"
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/ingest/status"
```

Xuat Excel (browser tai file):

```
https://cfl-feedback-worker.vinhviax.workers.dev/api/export?sources=store,fb_page,fb_group_csv&from=2026-07-01&to=2026-07-15
```

Quy trinh verify/deploy chuan (vi Drive khong on dinh):

```powershell
# copy source ra local
$DEST = "C:\Temp\cfl-<ten>-<yyyymmdd-hhmm>"
# copy worker/ va frontend/ (kem index.html, public/, .env.production cho frontend)
cd $DEST\worker; npm ci; npx vitest run; npx tsc --noEmit; npx wrangler deploy
cd $DEST\frontend; npm ci; npm run build; npx wrangler pages deploy ./dist --project-name=cfl-feedback
```
