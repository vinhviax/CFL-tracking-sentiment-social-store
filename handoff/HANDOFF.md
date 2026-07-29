# HANDOFF 2026-07-29

Ban giao cho agent/session tiep theo cua project **CFL Feedback Intelligence**.
(Cac session truoc nam o cuoi file, muc "## LICH SU cac session truoc".)

## Trang thai hien tai

- Workspace canonical (git repo): `J:\My Drive\CFL\Agent\Tracking Store Social` (branch `main`)
- Repo GitHub: `https://github.com/vinhviax/CFL-tracking-sentiment-social-store.git`
- Commit moi nhat da push: `31092bc Correct the stale CSV chunking note in MEMORY.md`
  - Commit chinh cua session: `c32e9ed Fix large Facebook CSV upload hitting Worker subrequest limit`
- Worker production: `https://cfl-feedback-worker.vinhviax.workers.dev`
  - **Da deploy trong session nay**: Version ID `66566f6e-3d41-499d-b137-7ee28ecc8e43`
- Pages production: `https://cfl-feedback.pages.dev`
  - **KHONG deploy trong session nay** (khong doi frontend). Deployment moi nhat van la `dae607a4`.
- Test: 154/154 pass (33 file), `tsc --noEmit` exit 0.
- **User da test tren production va confirm OK**: upload CSV Facebook file lon da chay duoc.

Working tree J: sach, local va `origin/main` da dong bo.

> ⚠️ **Luu y ve nhieu ban clone**: co it nhat 3 cho chua source:
> - `J:\My Drive\CFL\Agent\Tracking Store Social` = **canonical git, branch main** (nguon su that, edit o day). `J:` la mount cua Google Drive (volume label "Google Drive", 232 GB, root chi co `My Drive`).
> - `G:\CFM\Research\Crossfire Legends Sea` = clone CU, branch `codex/sensortower-zh-workspace`, HEAD `fb9fc9e` (06/07), ref `origin/main` cua no cung cu tu hom do. **CHUA co game-modes / taxonomy moi va CHUA co fix CSV.** ĐUNG dung lam nguon.
> - `C:\Temp\cfl-export-20260720-1442` = ban copy local (khong-git) da `npm ci`, dung de build/test/deploy (vi node_modules tren Drive treo vitest). Da sync khop J: sau session nay (`diff -rq` sach).
>
> ⚠️ **Chu o dia `G:` co nghia KHAC NHAU tuy may** — day la nguon nham lan chinh, user da xac nhan 2026-07-29:
> - **May cong ty (may dang chay session)**: `J:` = My Drive (volume label "Google Drive", 232 GB, root chi co `My Drive`). `G:` = o du lieu **local 4.6 TB** volume label "**Work**", khong co thu muc `My Drive`.
> - **May o nha**: `G:` = My Drive.
>
> Nen cung chuoi duong dan `G:\CFM\Research\Crossfire Legends Sea` tro toi **2 kho khac nhau tuy may**: o nha la Drive, o cong ty la o local. Drive o nha gan nhu chac chan la **account Google khac** — da search Drive API cua `vinhvnn@vng.com.vn` va **khong co thu muc `CFM` hay `Crossfire Legends Sea`** nao.
>
> ⇒ **Khong ban nao tu sync voi ban nao**: `G:` o cong ty la local, `G:` o nha nam trong Drive khac, `J:` nam trong Drive cong ty. **Chi GitHub noi chung lai.** O ban clone nao dang lac hau, chay:
>
> ```bash
> git fetch origin && git checkout main && git pull
> ```
>
> Luu y: vi ban `G:` o nha NAM TRONG Drive, cac gotcha ve Drive cung ap dung o do — `node_modules` treo vitest, `git fsck` bao `bad sha1 file`. Xem muc "Gotcha quan trong".

## Session nay lam gi

### Fix upload CSV Facebook file lon bi timeout / that bai giua duong (commit c32e9ed)

**Trieu chung user bao**: keo file CSV Facebook vao, bam nut nap, cho mot hoi roi bao loi. File cang dai cang chac chan loi. Nguong vo o khoang **~28-30k dong**.

**Nguyen nhan goc** (KHONG phai "file nang nen cham"): `POST /api/ingest/upload-csv` lam tat ca dong bo trong 1 Worker invocation, va **ca 2 cho tra cuu D1 deu gui gia tri cua chinh file lam bound parameter**, ma D1 chan bound parameter o ~90/statement → so subrequest ti le voi so dong file:

| Buoc | Truoc | Voi 30k dong |
|---|---|---|
| Dedupe `SELECT ... dedupe_hash IN (...)`, chunk 45 dong (moi dong 2 hash: hien tai + legacy) | N/45 query | **667** |
| Post lookup `SELECT ... external_id IN (...)`, chunk 90 | U/90 query | ~50-670 |
| Insert comment `db.batch` 100 | N/100 | **300** |
| **Tong** | | **>1000 → vuot gioi han 1000 subrequest/invocation** |

Cong them 2 buc tuong nua se dung tiep neu file lon hon: **CPU 30s** (`wrangler.jsonc` khong set `limits.cpu_ms`; `Promise.all` hash toan bo N dong cung luc, moi dong 2 lan SHA-256 → 60k digest cho 30k dong) va **edge timeout 524 sau 100s** (667 query D1 tuan tu × ~25ms + 300 batch × ~40ms).

**Cach fix — dao chieu tra cuu**: thay vi hoi D1 ve tung dong cua file, quet nhung gi DA CO trong DB. Chi phi lookup gio phu thuoc luong lich su trung khoang ngay, **khong con phu thuoc kich co file**.

- `loadExistingCsvHashes()` (moi, `worker/src/services/csvIngest.ts`): quet `comments` co `source_type IN ('fb_page','fb_group_csv')` trong khoang ngay cua file, phan trang keyset theo `id` (`CSV_DEDUPE_SCAN_PAGE_SIZE = 5000`). → **667 query con ~6-12**.
- `loadCsvPostIds()` (moi): quet `posts` theo prefix `external_id LIKE 'fanpage_csv:%' OR 'group_csv:%'`, phan trang. → **~1 query**, bo han vong `IN (...)` chunk 90.
- Insert batch 100 → **250** (ca comment va post). **Gioi han 100 bound param cua D1 la MOI STATEMENT, khong phai moi batch** — da check docs, khong co cap so statement trong `db.batch()`.
- Hashing chunk 2000 dong/luot (`CSV_HASH_CHUNK_SIZE`) thay vi `Promise.all` toan bo → chan dinh memory.
- `wrangler.jsonc`: them `"limits": { "cpu_ms": 60000 }` (mac dinh 30s khong du de decode + hash file lon).
- `validateFacebookCsvSize()` (moi): chan o **60.000 dong** (`CSV_MAX_IMPORTABLE_ROWS`) voi message tieng Viet "hay chia file thanh nhieu phan nho hon", thay cho loi runtime mu mo. Truoc day KHONG co gioi han nao ca.

**Ket qua**: file 30k dong tu **>1000 subrequest xuong ~130**. Nguong an toan moi **60.000 dong** — qua nguong nay Worker het memory 128MB khi decode file chu khong phai het subrequest, nen day la con so dung de chan.

**Nhung gi CO Y giu nguyen (dung "toi uu" tiep ma pha)**:
- Dedupe van so **ca hash hien tai VA hash legacy**. Ca 2 format nam cung cot `dedupe_hash` nen mot lan quet phu het.
- Cua so ngay **dem ±1 ngay** (`shiftDayKey`): CSV luu gio Bangkok local (`parseVnDate` → `YYYY-MM-DDTHH:MM:SS`) con Graph API ingest luu UTC (`parseFbDate` → `.toISOString()`), lech toi 7 tieng.
- Luon gom `created_at IS NULL` (dong co cot ngay khong parse duoc thi khong the loc theo range).
- Neu file khong co dong nao co ngay parse duoc → bo han dieu kien ngay, quet toan bo comment Facebook.

Tests moi trong `worker/src/services/csvIngest.test.ts`: stub D1 ghi lai SQL/params (`fakeDbReturning`) → verify quet 1 lan dung params, verify phan trang tiep khi page full va resume dung `id` cuoi, verify bo dieu kien ngay khi khong co ngay, verify budget subrequest o 60k dong < 900, verify message chia file.

## Viec co the lam tiep (chua lam)

- **File CSV bi upload + parse 2 LAN** — `onFileSelect` (`frontend/src/pages/IngestSettings.jsx:~598`) goi `previewCsv(file)` ngay khi keo vao, roi `confirmUpload` (`:~607`) goi `uploadCsv(file)` voi cung File do; worker parse lai tu dau ca 2 lan (`routes/ingest.ts:140` va `:125`). Bo duoc se giam nua thoi gian cho va nua ap luc memory. Huong don gian nhat: parse client-side cho phan preview (contract format ghi o dau `csvIngest.ts`). **Da tao task chip cho viec nay** (`task_d941cb7e`).
- **Zombie v4 chi 1 tag** — gan nhu thieu tu khoa (nguoi choi goi kieu khac: "zombie 4.0", "zb4", hoac chi "zombie"). Xin user vai cach goi thuc te → them keyword vao dinh nghia mode → chay lai `POST /api/game-modes/tag` (vai giay). User da noi "tinh sau".
- Neu user doi y muon loc subtopic doc lap tren workspace: backend da san sang (comments/stats/export deu EXISTS tren `comment_subtopics` doc lap topic); chi can bo `disabled={!filters.topic}` o dropdown Chu de con. User da tu choi 1 lan (chon "Giu nguyen").
- Chay `game-modes/tag` dinh ky khi co data moi (route idempotent).

## Gotcha quan trong (con hieu luc)

- **`node_modules` tren Google Drive (`J:`) lam vitest/npm treo vo han**. Quy trinh chuan: copy `worker/`+`frontend/` ra local (vd `C:\Temp\...`), `npm ci`, roi test/typecheck/build/deploy tu do. Truoc khi build/deploy luon `diff -rq` giua J: va C:\Temp — thuong **chi cac file vua sua** khac nhau; copy dung nhung file do sang, tranh revert nham.
- **D1 bound parameter**: gioi han ~90-100 **moi statement**, KHONG phai moi batch. `db.batch()` khong co cap so statement (da check docs). → dung chunk `IN (...)` theo gia tri cua file neu so luong ti le voi input; hay quet DB roi loc trong JS.
- **CSV ingest: dung quay lai kieu chunk `IN (...)` theo hash cua file** — do la chinh xac cai da gay loi >1000 subrequest. Xem `loadExistingCsvHashes` / `loadCsvPostIds`.
- **Pages la direct-upload (khong noi git)**: `npx wrangler pages deploy ./dist --project-name=cfl-feedback` tu thu muc non-git van tao deployment Environment=Production/Branch=main. Sau deploy alias `cfl-feedback.pages.dev` co the con phuc vu bundle cu vai giay (CDN cache) → Ctrl+F5 / them `?_cb=`.
- Frontend la **hash router**: trang Ingest o `#/ingest` (khong phai `/ingest`). Preview local: `npx vite preview --port <p>` roi mo `http://localhost:<p>/#/ingest`. Browser pane screenshot co the fail neu pane an → dung `read_page` (text) de verify.
- `/api/export` GET co the bi edge-cache → dung cache-buster rieng moi request khi smoke test.
- `deleteIngestRun` (`worker/src/services/deleteIngestRun.ts`) **CO cascade**: xoa run se xoa luon comments/analyses/translations/comment_subtopics/memory_evidence/orphan_posts cua run do. (Ghi chu cu "xoa run thi comment khong xoa theo" chi dung cho run #1-46 bi xoa truoc khi co service nay.)
- `xlsx` phai cai tu `cdn.sheetjs.com` (CVE tren npm registry) — xem `worker/package.json`.
- **Git tren checkout Drive**: `git fsck` in nhieu "bad sha1 file" du exit 0 — KHONG tu sua/xoa object. `status`/`log`/`commit`/`push main` chay binh thuong. `git commit` canh bao LF→CRLF la binh thuong tren Windows.

## Cau hinh LLM (khong doi trong session nay)

- Insight/HTML Report: `codex-lb/gpt-5.6-terra` (`LLM_INSIGHT_MODEL`).
- `reasoning` (phan tich comment, taxonomy/subtopic, game-mode verify): override D1 → `custom` → `codex-lb/gpt-5.6-terra`.
- `simple` (dich zh-CN): default `ag/gemini-3-flash-agent` qua provider `llm_viax`.
- LLM tunnel `rpi7jss.abc-tunnel.us` tung down (HTTP 530/1016) o cac session truoc; luc kiem tra cuoi (`/api/health` → `llm_ready: true`) van song.

## Lenh nhanh

Production smoke:

```powershell
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/health"
Invoke-RestMethod "https://cfl-feedback-worker.vinhviax.workers.dev/api/ingest/status"
```

Xem log worker that (huu ich khi debug ingest):

```powershell
npx wrangler tail cfl-feedback-worker --format pretty
```

Chay lai tag game-mode (idempotent):

```
POST https://cfl-feedback-worker.vinhviax.workers.dev/api/game-modes/tag
body: {"from":"2026-06-29","to":"2026-07-23","verify":true,"verify_batch_size":40}
```

Quy trinh verify/deploy **worker** chuan:

```powershell
$C = "C:\Temp\cfl-export-20260720-1442"
# 1. sua o J: (canonical) -> 2. diff -rq de biet file nao khac -> 3. copy sang $C\worker\src
cd "$C\worker"; npx vitest run; npx tsc --noEmit
npx wrangler deploy
# roi commit + push o J:
```

Quy trinh verify/deploy **frontend** chuan:

```powershell
$C = "C:\Temp\cfl-export-20260720-1442"
cd "$C\frontend"; npm run build
# verify: npx vite preview --port 4319 ; mo http://localhost:4319/#/ingest ; read_page
npx wrangler pages deploy ./dist --project-name=cfl-feedback
# roi commit + push o J:
```

---

## LICH SU cac session truoc

### Session 2026-07-23: taxonomy game-mode + UI lich su ingest

**A. Taxonomy game-mode + chay tag/verify tren production.** Chu de con "Mode choi" nam trong chu de lon `gameplay_mode_map`. 9 mode curated (parent_topic=`gameplay_mode_map`, key `gameplay_mode_map:<slug>`): C4 Kinh Te, C4 Thuong, Zombie v4, Zombie Truy Kich, Dau Dao, Dau Sniper, Dau Doi, Dau Don, Tron Tim. Route `POST /api/game-modes/tag` (`src/routes/gameModes.ts`, service `gameModeTagging.ts` + `gameModes.ts`), params `{from,to,verify,verify_batch_size,max_llm_batches,debug}`, **idempotent**. Buoc 1 keyword-only (source=`keyword`), buoc 2 LLM verify cac case mo ho ("c4"/"dat bom"/"solo"/"tdm") theo batch, LLM tra `{"results":[{"id":N,"modes":[...]}]}`, tag confirmed source=`keyword_llm`. Da chay full 2 buoc tren production 2026-06-29→2026-07-23 (30.115 comment): keyword 553 + LLM verify (796 candidate → +258) = **811 tag**. per_mode: C4 Kinh Te 299, C4 Thuong 260, Tron Tim 84, Zombie Truy Kich 51, Dau Dao 51, Dau Doi 40, Dau Don 14, Dau Sniper 11, Zombie v4 1. Da verify precision bang du lieu that; user CHOT giu nguyen dinh nghia C4 Kinh Te (299 = gop ca "kinh te"/"rank kinh te").

**B. UI Lich su Ingest: loc theo nguon + phan trang** (commit `339f836`, `frontend/src/pages/IngestSettings.jsx` + `index.css`). Segmented filter co dem so: Tat ca / Store / Fanpage / Group (Store=`store`, Fanpage=`fb_page`, Group=`facebook_csv`+`fb_group_csv`). Const `RUN_SOURCE_FILTERS` + `RUNS_PER_PAGE=50`. `loadRuns` doi `limit: 20` → `limit: 500` (truoc chi tai 20 run nen an cac run cu). Phan trang client-side 50 dong/trang.

**C. Da giai dap (khong sua code).** "Comment 29/6-13/7 dau?" → KHONG mat, 27.665 comment con nguyen, den tu run CSV #47 (`facebook_csv`, 14.514 dong moi); truoc bi an vi frontend chi tai 20 run. "Sao C4 Kinh Te tren web chi vai chuc?" → workspace loc Chu de chinh (`a.topic_main`) GIAO voi Chu de con, ma tag mode nam tren comment o nhieu chu de chinh khac nhau; muon xem DU 1 mode thi dung dialog Xuat Excel (chon Chu de con, Kieu=Tong quan, khong chon Chu de chinh).

### Session 2026-07-20: tinh nang Xuat Excel comment

Them chuc nang xuat comment ra Excel theo nguon + khoang thoi gian + chu de (commit `bf5f2f7..d6158bb`). Backend: helper chung `worker/src/services/commentFilters.ts` (`buildCommentFilters`) cho ca `/api/comments` va `/api/export`; `/api/export` nhan `sources` (csv list) → moi nguon 1 sheet; them cot Quoc gia / Cho ung dung / Link post FB; `MAX_EXPORT_ROWS=50000` (tra 413 neu vuot). Frontend: `ExcelExportDialog` trong `FeedbackWorkspace.jsx` (multi-select nguon, ghi chu ngay data moi nhat, chon chu de, khoang ngay). Da deploy + verify production. Tests: `commentFilters.test.ts`, `export.test.ts`, `FeedbackWorkspace.ui.test.js`.
