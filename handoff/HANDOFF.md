# HANDOFF 2026-07-29 (phien 2 — refactor LLM provider + fix pipeline)

Ban giao cho agent/session tiep theo cua project **CFL Feedback Intelligence**.
(Phien truoc trong cung ngay — token metering + fix upload CSV — nam trong muc lich su ben duoi. Cac session cu hon nam sau cung.)

## ⚠️ VIEC DANG CHAY — DOC TRUOC KHI LAM GI KHAC

**33 run dang duoc phan tich lai + dich lai tren production**, kich hoat cuoi phien nay (`force:true`). Cron 5 phut (`*/5 * * * *`) se tu drain queue qua dem, khong can may tinh nao mo. Khi ban vao lai:

1. Kiem tra con bao nhieu comment con la fallback tu khoa — query D1 truc tiep (xem "Lenh nhanh" ben duoi):
   `SELECT COUNT(*) FROM analyses WHERE (summary IS NULL OR TRIM(summary)='') AND confidence=0.35`.
   Moc do duoc trong phien nay: **58.718** (dau phien, truoc khi kich hoat) → **58.500** (sau khi kich hoat 33 run) → **58.180** (sau ~10 phut chay vong lap drain nen). Toc do quan sat duoc: **~1 comment/giay** khi chay drain lien tuc (~300/lan drain, drain ~5 phut/lan do gioi han 115s + queue concurrency). Voi toc do nay, **58.180 comment con lai can khoang 16 gio chay lien tuc** — cron 5 phut mot minh se cham hon nhieu vi moi lan chi 1 chu ky claim, nen **nen tiep tuc chay vong lap drain thu cong** (xem "Lenh nhanh") thay vi chi cho cron.
   - Mot **vong lap drain 60 lan (~115s/lan) da duoc khoi dong o cuoi phien nay va con dang chay ngam** luc handoff duoc viet — kiem tra tien do truoc, co the no da lam giam duoc kha nhieu roi.
2. Neu con nhieu (queue chua chay het qua dem), **dung vong lap drain dong bo** thay vi cho cron — cron chi chay 1 lan/5 phut nen rat cham cho khoi luong lon nay. Xem muc "Lenh nhanh" — vong lap `POST /api/processing/drain`.
3. Neu da xong het (con_keyword ~0), kiem tra chat luong bang cach doc vai dong `summary` that va bao cho user.

**Danh sach 33 run da kich hoat** (analysis + translation, force=true), ID:
```
47 51 53 54 55 56 57 58 59 61 62 63 64 65 67 69 70 71 72 73
75 77 79 81 82 83 85 86 87 89 91 95 99
```
3 run lon nhat: **#99** (27.478 comment), **#47** (14.482), **#53** (8.988) — cong lai la 87% khoi luong. Run **#93** va **#97** da xong tu truoc (session nay).

## Trang thai hien tai

- Workspace canonical (git repo): `J:\My Drive\CFL\Agent\Tracking Store Social` (branch `main`)
- Repo GitHub: `https://github.com/vinhviax/CFL-tracking-sentiment-social-store.git`
- Commit moi nhat da push: `032c0ff Make "Phân tích lại" and "Dịch lại" actually redo the work`
- Worker production: `https://cfl-feedback-worker.vinhviax.workers.dev` — **Version ID `9af79891-6d89-4613-8cf5-7e7e73f6f330`**
- Pages production: `https://cfl-feedback.pages.dev` — deployment `f5b42091`
- Test: worker 210/210, frontend 74/74, `tsc --noEmit` exit 0.
- Working tree J: sach, local va `origin/main` da dong bo.

> Xem canh bao ve nhieu ban clone (`G:` local vs Drive, workspace `C:\Temp\...`) o cuoi file — khong doi trong phien nay, van dung.

## Phien nay lam gi (theo thu tu)

### A. Refactor toan bo he thong chon Provider LLM

**Ly do**: user thay UI cu (4 provider option + checkbox "Bat override") kho hieu va de bam nham.

**6 provider co dinh** (`worker/src/services/llmCatalog.ts`, khong con enum tu do):
1. `gemini_viax` — Gemini by Viax, endpoint `rpi7jss.abc-tunnel.us/v1`, chi 1 model `ag/gemini-3-flash-agent`
2. `openai_viax` — OpenAI by Viax, endpoint `agent-shop.clawd.io.vn/v1`, 2 model `gpt-5.6-terra` / `gpt-5.6-luna` (**KHONG co prefix `codex-lb/`** — xem muc B)
3. `anthropic_direct`, `gemini_direct`, `openai_direct` — "chinh chu", dung endpoint studio that, user tu nhap model + API key
4. `custom` — user tu nhap ca endpoint + model + API key

**Default**: Suy luan = `openai_viax`/`gpt-5.6-terra`; Don gian = `gemini_viax`/`ag/gemini-3-flash-agent`.

**Override da xoa hoan toan.** Chon slot gio chi la chon 1 trong 6 provider + model.

**Provider tu nhap key (3 "chinh chu" + Custom) KHONG LUU LEN SERVER**:
- Song trong `sessionStorage` cua browser (`frontend/src/utils/llmSession.js`) — F5 cung tab con giu, mo tab moi hoac Ctrl+F5 thi mat.
- Gui theo header `X-CFL-LLM-Config` cho MOI request co the goi LLM (ca GET polling, vi do la cai drain queue) — khong dung query string vi chua API key.
- Neu tab dong hoac request khong mang header nay (vd cron), pipeline **tu dong dung provider da luu cua slot** — day la danh doi co chu y cua viec khong luu key.

**Endpoint/API key KHONG BAO GIO tra ve client** — `/api/llm-config` chi tra ten provider + model rut gon (vd `gpt-5.6-terra`, khong con prefix).

**Migration**: `0012_llm_provider_catalog.sql` tao bang `llm_provider_secrets` (endpoint+key cho cac provider "by Viax"), copy key cu tu `llm_agent_configs` (khong bao gio doc ra ngoai), roi rebuild `llm_agent_configs` chi con `(slot, provider, model)`.

**5 cho goi LLM da doi de dung chung 1 co che resolve** (`resolveLlmProviderChain`) — truoc day chi 2/5 cho (`analysis.ts`, `taxonomyMemory.ts`) di qua slot config, con **Insight/Report, dich zh-CN, va game-mode verify goi thang bien moi truong `wrangler.jsonc`, bo qua hoan toan config UI**. Gio ca 5 deu qua slot.

### B. 3 bug production phat hien trong luc refactor (khong phai do refactor gay ra)

**B1. Sai ten model.** `agent-shop.clawd.io.vn` can ten model **tran** (`gpt-5.6-terra`), khong phai `codex-lb/gpt-5.6-terra` (prefix `codex-lb/` la cach proxy `rpi7jss` dinh tuyen, dung sai endpoint la 403). Da fix trong catalog + migration `0013_fix_openai_viax_model_names.sql`.

**B2. Thieu chu "json" trong prompt.** `agent-shop` dich Chat Completions sang Responses API va **tu choi thang** `response_format: json_object` neu khong co message nao chua chu "json": `"Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'"`. Fix o tang transport (`ensureMentionsJson` trong `worker/src/services/llm/providers.ts`) — tu dong them cau nhac nho neu prompt chua co, khong sua tung prompt rieng le (tranh tai phat sinh khi ai do sua prompt sau nay).

**B3. LLM CHUA TUNG phan tich duoc comment nao — 59.034 dong deu la keyword fallback.** Phat hien khi kiem tra: **100% analyses co `confidence=0.35` chinh xac va `summary` rong**, tu 07/07 den 29/07. Nguyen nhan la B1 (chon sai model → 403 → catch → fallback tu khoa), nhung **an di 12+ ngay** vi code ghi `model = model_da_cau_hinh` bat ke LLM hay fallback tao ra dong do — nhin DB tuong van chay tot. Da fix: `analysis.ts` gio ghi `provider='fallback', model=NULL` khi that su fallback, va ghi `level='error'` vao processing_logs de nhin thay ngay tren UI. **Day la ly do chinh phai chay lai phan tich cho toan bo du lieu cu — xem muc "VIEC DANG CHAY" o dau file.**

### C. Them rule fallback 2 tang (theo yeu cau user)

Neu provider chinh loi → **tu dong thu lai qua Gemini by Viax** → chi khi Gemini cung loi moi roi ve keyword fallback. Code moi: `worker/src/services/llm/chain.ts` (`completeJsonWithFallback`/`completeTextWithFallback`). Da verify that tren production bang log:
```
insight openai_viax/codex-lb/gpt-5.6-terra failed (403 model_not_allowed); retried via gemini_viax
```

### D. Co che tu chua khi batch/queue bi dung (theo yeu cau user)

User bao "lau lau batch dang chay bi loi 502 hay gi do lam dung lai". Tim ra **3 lo hong doc lap**:
1. 1 batch loi → `Promise.all` trong `mapWithConcurrency` reject → HUY LUON cac batch song song dang chay, mat het viec da xong. **Fix**: batch loi gio duoc ghi nhan va bo qua, khong throw; job tra `complete:false` de requeue, lan sau chi chon lai comment CHUA co analysis (idempotent).
2. Job loi lan dau la bi mark `failed` vinh vien, khong retry. **Fix**: them cot `attempts` (migration `0014`), retry toi da 200 lan (guard, khong phai budget thuc — moi lan la tien do that vi chi chon comment con thieu).
3. Drain chay trong `ctx.waitUntil` cua request POLLING NGAN — Cloudflare cat `waitUntil` sau ~30s, batch LLM chay lau hon bi giet giua chung, job ket lai `running` mai mai cho den khi stale-recovery (10 phut → rut xuong **3 phut**, do lieness bang log moi nhat chu khong phai `started_at`).

Them **cron 5 phut** (`*/5 * * * *` trong `wrangler.jsonc`) chi de sweep + drain — khong phu thuoc browser mo tab nua. Them **endpoint dong bo** `POST /api/processing/drain` — await drain ngay trong request (khong qua `waitUntil`) de dung trong vong lap thu cong khi can day nhanh khoi luong lon (xem "Lenh nhanh").

**Batch size cung la nguyen nhan lam run dung im**: 50 comment/batch vuot ngan sach 1 invocation → moi batch chi kip log "started", khong bao gio "completed". Da giam **`CLASSIFY_BATCH_SIZE`/`ANALYSIS_BATCH_SIZE`/`TRANSLATION_BATCH_SIZE` tu 50→20**, tang `LLM_BATCH_CONCURRENCY` 3→5, `PROCESSING_JOB_MAX_BATCHES` 3→5. Kiem chung: run #93 tu `done:0` nhay len `done:150/178` chi sau 1 lan drain sau khi doi config.

### E. Fix 2 nut "Phan tich lai" / "Dich lai" — TRUOC DAY LA NO-OP HOAN TOAN

Phat hien khi user hoi "nut phan tich lai dang sai cho nao". Ca 2 nut bam xong khong lam gi ca tren run da chay:
- **Phan tich lai**: frontend gui `only_unanalyzed: true` — backend **khong doc tham so nay bao gio**. Backend luon loc `prompt_version != 'v4'`; ma dong fallback van ghi dung `v4` nen bi coi la "da xong" → tra `0/0`.
- **Dich lai**: frontend **khong gui `force`**; `pendingTranslations` doi `t.comment_id IS NULL` nen comment da co ban dich (moi comment deu co) bi bo qua het.

**Fix**: `runAnalyze`/`runTranslate` o frontend gui `force: run.analysis_status === "done"` (tuc chi force khi nhan da doi thanh "lai"). Backend `pendingComments` nhan `force` + `forceSince` (moc thoi gian job duoc claim lan dau, dung de retry hoi tu chu khong lap lai tu dau vinh vien).

## Cau hoi con treo: co can dich lai summary khong?

User hoi rieng cau nay. Tra loi: **ban dich COMMENT thi khong can** (0/58.718 rong, noi dung khong doi). Nhung **ban dich SUMMARY thi co** — vi luc dich, summary tieng Viet dang RONG (truoc khi co phan tich LLM that), nen `summary_translated` hoac rong (24.948 dong) hoac dich tu chuoi rong (khong khop gi voi summary moi sau khi phan tich lai). Hien **chua co che do "chi dich lai summary"** — bam "Dich lai" se dich lai CA comment lan summary, ton them token vo ich cho phan comment (da dung roi). Neu muon toi uu, co the them mode rieng — chua lam trong phien nay, hoi user truoc khi lam vi la thay doi hanh vi API.

## Lenh nhanh

**Kiem tra con bao nhieu comment con fallback:**
```powershell
cd "C:\Temp\cfl-export-20260720-1442\worker"
npx wrangler d1 execute cfl-feedback --remote --json --command "SELECT COUNT(*) AS con_keyword FROM analyses WHERE (summary IS NULL OR TRIM(summary)='') AND confidence=0.35"
```

**Vong lap drain dong bo** (dung khi can day nhanh, moi lan xu ly toi da 3 job song song x 5 batch x 20 comment ~ 300 comment/lan, gioi han 115s/lan vi edge timeout 100s):
```powershell
$B = "https://cfl-feedback-worker.vinhviax.workers.dev"
for ($i=0; $i -lt 60; $i++) {
  try { Invoke-RestMethod -Method Post -Uri "$B/api/processing/drain?d=$(Get-Random)" -TimeoutSec 115 | Out-Null } catch {}
}
```

**Xem run nao con can chay** (danh sach 33 ID da liet ke o dau file; kiem tra tung run):
```powershell
Invoke-RestMethod "$B/api/analyze/progress/run-99"
```

**Health / cau hinh LLM hien tai:**
```powershell
Invoke-RestMethod "$B/api/health"
Invoke-RestMethod "$B/api/llm-config"
```

**Xem log worker that** (huu ich neu batch loi lai):
```powershell
cd "C:\Temp\cfl-export-20260720-1442\worker"; npx wrangler tail cfl-feedback-worker --format pretty
```

## Gotcha quan trong (con hieu luc, cong them phien nay)

- **Nut "Phan tich lai"/"Dich lai" phai gui `force`** — neu sau nay sua code frontend, dung vo tinh bo mat tham so nay, no se quay lai thanh no-op im lang y het bug vua fix.
- **`prompt_version` KHONG phai bang chung LLM da chay** — no chi la version cua PROMPT, khong phai cua "provider da tao ra dong nay". Muon biet co that su la LLM hay fallback, kiem tra `summary` rong + `confidence=0.35` dong thoi (chu ky cua `classifyFallback`).
- **Batch size 20 la ket qua do luong that, dung tang lai 50** neu chua co ly do ro rang — se lam run dung im (moi batch "started" khong bao gio "completed").
- **`STALE_RUNNING_MS` = 3 phut, do bang log moi nhat cua job** (khong phai `started_at`/`updated_at` don thuan) — dung sua ve cach do cu, se lam job "con song" gia tao keo dai maimai.
- **Endpoint drain dong bo `POST /api/processing/drain` co "takeover window" 20s** — no co the chiem lai job dang `running` neu khong co log moi trong 20s, de tranh deadlock voi drain qua `waitUntil` (drain chet giua chung van kip ghi log "started" truoc, lam job trong "con song" voi cua so stale 3 phut cu).
- **`llm_provider_secrets` la bang MOI, chua migration `0012`** — endpoint/key cua `openai_viax` nam o day, khong con o `llm_agent_configs`. Neu can doi key `agent-shop`, sua bang nay.
- Cac gotcha cu (Drive/G:/C:\Temp, Pages cache, D1 bound param 90, xlsx CVE, git tren Drive) van dung nguyen — xem lich su ben duoi.

## Cau hinh LLM (sau refactor)

- Suy luan (phan tich comment, taxonomy discovery, game-mode verify, Insight/Report): mac dinh `openai_viax` / `gpt-5.6-terra`.
- Don gian (dich zh-CN): mac dinh `gemini_viax` / `ag/gemini-3-flash-agent`.
- Fallback tu dong: bat ky provider nao loi → thu `gemini_viax` → moi that bai het moi ve keyword/copy-nguyen-van.
- Sua qua UI: nut "Cau hinh LLM Agent" trong Ingest Settings, hoac `PUT /api/llm-config/:slot {provider, model}` (chi nhan 2 provider "by Viax", provider "chinh chu"/"custom" tu choi luu — loi ro rang neu thu).

---

## LICH SU cac session/phien truoc

### Phien 1, cung ngay 2026-07-29: Token metering + fix upload CSV 2 lan

- Fix upload CSV Facebook lon bi vuot 1000 subrequest/invocation (commit `c32e9ed`) — dedupe/post lookup chuyen tu chunk `IN(...)` sang quet DB theo khoang ngay/prefix.
- Bat token usage tracking: provider tra `{content, usage}` thay vi string thuan (`e0a5a57`), aggregate theo run + theo khoang ngay (`e8e36e3`), hien thi UI trong Lich su Ingest (`f0eb349`).
- Bo upload CSV 2 lan: preview parse ngay tren browser thay vi goi API preview roi goi API upload (`5313260`).
- Phat hien "G:" tren may nay la o local, khong phai Google Drive — da ghi vao MEMORY va handoff.

### Session 2026-07-23: taxonomy game-mode + UI lich su ingest

9 mode curated duoi `gameplay_mode_map`. Route `POST /api/game-modes/tag`, idempotent, 2 buoc keyword + LLM verify. Da chay full tren production 2026-06-29→2026-07-23 (811 tag). UI loc nguon + phan trang trong Lich su Ingest.

### Session 2026-07-20: tinh nang Xuat Excel comment

Xuat comment ra Excel theo nguon + khoang thoi gian + chu de. Backend `commentFilters.ts`, frontend `ExcelExportDialog`.
