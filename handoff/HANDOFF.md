# HANDOFF 2026-07-29 (phiên 2 — refactor LLM provider + fix pipeline)

Bàn giao cho agent/session tiếp theo của project **CFL Feedback Intelligence**.
(Phiên trước trong cùng ngày — token metering + fix upload CSV — nằm trong mục lịch sử bên dưới. Các session cũ hơn nằm sau cùng.)

## ⚠️ VIỆC ĐANG CHẠY — ĐỌC TRƯỚC KHI LÀM GÌ KHÁC

**33 run đang được phân tích lại + dịch lại trên production**, kích hoạt cuối phiên trước (`force:true`). Cron 5 phút (`*/5 * * * *`) sẽ tự drain queue qua đêm, không cần máy tính nào mở. Khi bạn vào lại:

1. Kiểm tra còn bao nhiêu comment còn là fallback từ khóa — query D1 trực tiếp (xem "Lệnh nhanh" bên dưới):
   `SELECT COUNT(*) FROM analyses WHERE (summary IS NULL OR TRIM(summary)='') AND confidence=0.35`.
   Mốc đo được: **58.718** (đầu phiên, trước khi kích hoạt) → 58.500 → 58.180 → 57.920 → 54.898 → 53.898 → **53.535** (mốc cuối cùng đo được trước khi kết thúc phiên). Tốc độ quan sát được: **~1 comment/giây** khi chạy drain liên tục. Với tốc độ này, phần còn lại cần nhiều giờ chạy liên tục — cron 5 phút một mình sẽ chậm hơn nhiều vì mỗi lần chỉ 1 chu kỳ claim.
2. Nếu còn nhiều (queue chưa chạy hết qua đêm), **dùng vòng lặp drain đồng bộ** thay vì chờ cron — xem mục "Lệnh nhanh" — vòng lặp `POST /api/processing/drain`. Cuối phiên trước đã khởi động một vòng lặp nền 200 lần drain (~115s/lần) — kiểm tra xem nó đã chạy xong chưa và số liệu đã giảm tới đâu trước khi khởi động vòng lặp mới.
3. Nếu đã xong hết (con_keyword ~0), kiểm tra chất lượng bằng cách đọc vài dòng `summary` thật và báo cho user.
4. **Sau khi TẤT CẢ run đã chạy xong** (con_keyword ~0 hoặc rất thấp, chỉ còn vài dòng thật sự không phân loại được), **sửa lỗi hiển thị UI đã ghi ở mục F bên dưới** — user đã yêu cầu để lỗi đó lại, ưu tiên chạy xong data trước.

**Danh sách 33 run đã kích hoạt** (analysis + translation, force=true), ID:
```
47 51 53 54 55 56 57 58 59 61 62 63 64 65 67 69 70 71 72 73
75 77 79 81 82 83 85 86 87 89 91 95 99
```
3 run lớn nhất: **#99** (27.478 comment), **#47** (14.482), **#53** (8.988) — cộng lại là 87% khối lượng. Run **#93** và **#97** đã xong từ trước (session này).

## Trạng thái hiện tại

- Workspace canonical (git repo): `J:\My Drive\CFL\Agent\Tracking Store Social` (branch `main`)
- Repo GitHub: `https://github.com/vinhviax/CFL-tracking-sentiment-social-store.git`
- Commit mới nhất đã push: `032c0ff Make "Phân tích lại" and "Dịch lại" actually redo the work`
- Worker production: `https://cfl-feedback-worker.vinhviax.workers.dev` — **Version ID `9af79891-6d89-4613-8cf5-7e7e73f6f330`**
- Pages production: `https://cfl-feedback.pages.dev` — deployment `f5b42091`
- Test: worker 210/210, frontend 74/74, `tsc --noEmit` exit 0.
- Working tree J: sạch, local và `origin/main` đã đồng bộ.

> Xem cảnh báo về nhiều bản clone (`G:` local vs Drive, workspace `C:\Temp\...`) ở cuối file — không đổi trong phiên này, vẫn đúng.

## Phiên trước đã làm gì (theo thứ tự)

### A. Refactor toàn bộ hệ thống chọn Provider LLM

**Lý do**: user thấy UI cũ (4 provider option + checkbox "Bật override") khó hiểu và dễ bấm nhầm.

**6 provider cố định** (`worker/src/services/llmCatalog.ts`, không còn enum tự do):
1. `gemini_viax` — Gemini by Viax, endpoint `rpi7jss.abc-tunnel.us/v1`, chỉ 1 model `ag/gemini-3-flash-agent`
2. `openai_viax` — OpenAI by Viax, endpoint `agent-shop.clawd.io.vn/v1`, 2 model `gpt-5.6-terra` / `gpt-5.6-luna` (**KHÔNG có prefix `codex-lb/`** — xem mục B)
3. `anthropic_direct`, `gemini_direct`, `openai_direct` — "chính chủ", dùng endpoint studio thật, user tự nhập model + API key
4. `custom` — user tự nhập cả endpoint + model + API key

**Mặc định**: Suy luận = `openai_viax`/`gpt-5.6-terra`; Đơn giản = `gemini_viax`/`ag/gemini-3-flash-agent`.

**Override đã xóa hoàn toàn.** Chọn slot giờ chỉ là chọn 1 trong 6 provider + model.

**Provider tự nhập key (3 "chính chủ" + Custom) KHÔNG LƯU LÊN SERVER**:
- Sống trong `sessionStorage` của browser (`frontend/src/utils/llmSession.js`) — F5 cùng tab còn giữ, mở tab mới hoặc Ctrl+F5 thì mất.
- Gửi theo header `X-CFL-LLM-Config` cho MỌI request có thể gọi LLM (cả GET polling, vì đó là cái drain queue) — không dùng query string vì chứa API key.
- Nếu tab đóng hoặc request không mang header này (vd cron), pipeline **tự động dùng provider đã lưu của slot** — đây là đánh đổi có chủ ý của việc không lưu key.

**Endpoint/API key KHÔNG BAO GIỜ trả về client** — `/api/llm-config` chỉ trả tên provider + model rút gọn (vd `gpt-5.6-terra`, không còn prefix).

**Migration**: `0012_llm_provider_catalog.sql` tạo bảng `llm_provider_secrets` (endpoint+key cho các provider "by Viax"), copy key cũ từ `llm_agent_configs` (không bao giờ đọc ra ngoài), rồi rebuild `llm_agent_configs` chỉ còn `(slot, provider, model)`.

**5 chỗ gọi LLM đã đổi để dùng chung 1 cơ chế resolve** (`resolveLlmProviderChain`) — trước đây chỉ 2/5 chỗ (`analysis.ts`, `taxonomyMemory.ts`) đi qua slot config, còn **Insight/Report, dịch zh-CN, và game-mode verify gọi thẳng biến môi trường `wrangler.jsonc`, bỏ qua hoàn toàn config UI**. Giờ cả 5 đều qua slot.

### B. 3 bug production phát hiện trong lúc refactor (không phải do refactor gây ra)

**B1. Sai tên model.** `agent-shop.clawd.io.vn` cần tên model **trần** (`gpt-5.6-terra`), không phải `codex-lb/gpt-5.6-terra` (prefix `codex-lb/` là cách proxy `rpi7jss` định tuyến, dùng sai endpoint là 403). Đã fix trong catalog + migration `0013_fix_openai_viax_model_names.sql`.

**B2. Thiếu chữ "json" trong prompt.** `agent-shop` dịch Chat Completions sang Responses API và **từ chối thẳng** `response_format: json_object` nếu không có message nào chứa chữ "json": `"Response input messages must contain the word 'json' in some form to use 'text.format' of type 'json_object'"`. Fix ở tầng transport (`ensureMentionsJson` trong `worker/src/services/llm/providers.ts`) — tự động thêm câu nhắc nhở nếu prompt chưa có, không sửa từng prompt riêng lẻ (tránh tái phát sinh khi ai đó sửa prompt sau này).

**B3. LLM CHƯA TỪNG phân tích được comment nào — 59.034 dòng đều là keyword fallback.** Phát hiện khi kiểm tra: **100% analyses có `confidence=0.35` chính xác và `summary` rỗng**, từ 07/07 đến 29/07. Nguyên nhân là B1 (chọn sai model → 403 → catch → fallback từ khóa), nhưng **ẩn đi 12+ ngày** vì code ghi `model = model_đã_cấu_hình` bất kể LLM hay fallback tạo ra dòng đó — nhìn DB tưởng vẫn chạy tốt. Đã fix: `analysis.ts` giờ ghi `provider='fallback', model=NULL` khi thật sự fallback, và ghi `level='error'` vào processing_logs để nhìn thấy ngay trên UI. **Đây là lý do chính phải chạy lại phân tích cho toàn bộ dữ liệu cũ — xem mục "VIỆC ĐANG CHẠY" ở đầu file.**

### C. Thêm rule fallback 2 tầng (theo yêu cầu user)

Nếu provider chính lỗi → **tự động thử lại qua Gemini by Viax** → chỉ khi Gemini cũng lỗi mới rơi về keyword fallback. Code mới: `worker/src/services/llm/chain.ts` (`completeJsonWithFallback`/`completeTextWithFallback`). Đã verify thật trên production bằng log:
```
insight openai_viax/codex-lb/gpt-5.6-terra failed (403 model_not_allowed); retried via gemini_viax
```

### D. Cơ chế tự chữa khi batch/queue bị đứng (theo yêu cầu user)

User báo "lâu lâu batch đang chạy bị lỗi 502 hay gì đó làm đứng lại". Tìm ra **3 lỗ hổng độc lập**:
1. 1 batch lỗi → `Promise.all` trong `mapWithConcurrency` reject → HỦY LUÔN các batch song song đang chạy, mất hết việc đã xong. **Fix**: batch lỗi giờ được ghi nhận và bỏ qua, không throw; job trả `complete:false` để requeue, lần sau chỉ chọn lại comment CHƯA có analysis (idempotent).
2. Job lỗi lần đầu là bị mark `failed` vĩnh viễn, không retry. **Fix**: thêm cột `attempts` (migration `0014`), retry tối đa 200 lần (guard, không phải budget thực — mỗi lần là tiến độ thật vì chỉ chọn comment còn thiếu).
3. Drain chạy trong `ctx.waitUntil` của request POLLING NGẮN — Cloudflare cắt `waitUntil` sau ~30s, batch LLM chạy lâu hơn bị giết giữa chừng, job kẹt lại `running` mãi mãi cho đến khi stale-recovery (10 phút → rút xuống **3 phút**, đo liveness bằng log mới nhất chứ không phải `started_at`).

Thêm **cron 5 phút** (`*/5 * * * *` trong `wrangler.jsonc`) chỉ để sweep + drain — không phụ thuộc browser mở tab nữa. Thêm **endpoint đồng bộ** `POST /api/processing/drain` — await drain ngay trong request (không qua `waitUntil`) để dùng trong vòng lặp thủ công khi cần đẩy nhanh khối lượng lớn (xem "Lệnh nhanh").

**Batch size cũng là nguyên nhân làm run đứng im**: 50 comment/batch vượt ngân sách 1 invocation → mỗi batch chỉ kịp log "started", không bao giờ "completed". Đã giảm **`CLASSIFY_BATCH_SIZE`/`ANALYSIS_BATCH_SIZE`/`TRANSLATION_BATCH_SIZE` từ 50→20**, tăng `LLM_BATCH_CONCURRENCY` 3→5, `PROCESSING_JOB_MAX_BATCHES` 3→5. Kiểm chứng: run #93 từ `done:0` nhảy lên `done:150/178` chỉ sau 1 lần drain sau khi đổi config.

### E. Fix 2 nút "Phân tích lại" / "Dịch lại" — TRƯỚC ĐÂY LÀ NO-OP HOÀN TOÀN

Phát hiện khi user hỏi "nút phân tích lại đang sai chỗ nào". Cả 2 nút bấm xong không làm gì cả trên run đã chạy:
- **Phân tích lại**: frontend gửi `only_unanalyzed: true` — backend **không đọc tham số này bao giờ**. Backend luôn lọc `prompt_version != 'v4'`; mà dòng fallback vẫn ghi đúng `v4` nên bị coi là "đã xong" → trả `0/0`.
- **Dịch lại**: frontend **không gửi `force`**; `pendingTranslations` đòi `t.comment_id IS NULL` nên comment đã có bản dịch (mọi comment đều có) bị bỏ qua hết.

**Fix**: `runAnalyze`/`runTranslate` ở frontend gửi `force: run.analysis_status === "done"` (tức chỉ force khi nhãn đã đổi thành "lại"). Backend `pendingComments` nhận `force` + `forceSince` (mốc thời gian job được claim lần đầu, dùng để retry hội tụ chứ không lặp lại từ đầu vĩnh viễn).

### F. Lỗi hiển thị UI — CHƯA SỬA, để sau khi chạy xong 33 run

User báo "sao tôi chả thấy gì" khi nhìn danh sách "Hàng đợi xử lý" trong Ingest Settings: nhiều run hiện **"Đang chờ phân tích ... 0/0 comment"** và **"Chưa có log LLM cho task này"**, trông như bị treo.

**Đã xác nhận đây KHÔNG phải bug chạy sai — chỉ là cách hiển thị gây hiểu lầm.** Queue giới hạn `PROCESSING_QUEUE_CONCURRENCY=3` job chạy song song cùng lúc. Với 33 run được kích hoạt cùng lúc, 2 run khổng lồ (#47 14.482 comment, #53 8.988 comment) liên tục tự requeue rồi tự claim lại ngay (vì FIFO luôn chọn ID nhỏ nhất trong hàng `queued`, và job đó lại chính là ID nhỏ nhất sau khi tự đưa mình về `queued`) → chiếm gần như vĩnh viễn 2/3 slot. Slot còn lại xoay vòng phục vụ các run nhỏ theo đúng thứ tự kích hoạt. Job nào chưa từng được claim thì `GET /api/analyze/progress/:key` trả về `{"status":"queued","done":0,"total":0}` — đúng sự thật, chỉ là **chưa tới lượt**, không phải lỗi.

**Việc cần sửa sau này** (đã hoãn theo yêu cầu user, ưu tiên chạy xong data trước):
- UI nên phân biệt rõ "queued nhưng chưa từng được claim" (trạng thái thật, `total` chưa biết) với "đang chạy" và "bị treo thật sự" — hiện cả 3 trạng thái đều na ná nhau trên UI, gây hiểu lầm là hỏng.
- Cân nhắc hiển thị vị trí trong hàng đợi (vd "Đang chờ, còn N job phía trước") để user không tưởng là bug.
- Cân nhắc: 2 run siêu lớn (#47, #53) có nên tách thành job kích thước giới hạn hơn (theo comment_ids con thay vì cả run) để không chiếm slot liên tục, cho các run nhỏ chạy song song thay vì xếp hàng dài? Đây là thay đổi kiến trúc, cần bàn với user trước khi làm.
- File liên quan: `frontend/src/pages/IngestSettings.jsx` (component hiển thị "Hàng đợi xử lý" / tracked jobs), `worker/src/services/processingQueue.ts` (logic FIFO + concurrency).

## Câu hỏi còn treo: có cần dịch lại summary không?

User hỏi riêng câu này. Trả lời: **bản dịch COMMENT thì không cần** (0/58.718 rỗng, nội dung không đổi). Nhưng **bản dịch SUMMARY thì có** — vì lúc dịch, summary tiếng Việt đang RỖNG (trước khi có phân tích LLM thật), nên `summary_translated` hoặc rỗng (24.948 dòng) hoặc dịch từ chuỗi rỗng (không khớp gì với summary mới sau khi phân tích lại). Hiện **chưa có chế độ "chỉ dịch lại summary"** — bấm "Dịch lại" sẽ dịch lại CẢ comment lẫn summary, tốn thêm token vô ích cho phần comment (đã đúng rồi). Nếu muốn tối ưu, có thể thêm mode riêng — chưa làm trong phiên này, hỏi user trước khi làm vì là thay đổi hành vi API.

## Lệnh nhanh

**Kiểm tra còn bao nhiêu comment còn fallback:**
```powershell
cd "C:\Temp\cfl-export-20260720-1442\worker"
npx wrangler d1 execute cfl-feedback --remote --json --command "SELECT COUNT(*) AS con_keyword FROM analyses WHERE (summary IS NULL OR TRIM(summary)='') AND confidence=0.35"
```

**Vòng lặp drain đồng bộ** (dùng khi cần đẩy nhanh, mỗi lần xử lý tối đa 3 job song song x 5 batch x 20 comment ~ 300 comment/lần, giới hạn 115s/lần vì edge timeout 100s):
```powershell
$B = "https://cfl-feedback-worker.vinhviax.workers.dev"
for ($i=0; $i -lt 60; $i++) {
  try { Invoke-RestMethod -Method Post -Uri "$B/api/processing/drain?d=$(Get-Random)" -TimeoutSec 115 | Out-Null } catch {}
}
```

**Xem run nào con cần chạy** (danh sách 33 ID đã liệt kê ở đầu file; kiểm tra từng run):
```powershell
Invoke-RestMethod "$B/api/analyze/progress/run-99"
```

**Xem trạng thái toàn bộ hàng đợi** (đếm theo job_type + status, hữu ích để biết run nào đang thật sự chạy vs xếp hàng):
```powershell
npx wrangler d1 execute cfl-feedback --remote --json --command "SELECT job_type, status, COUNT(*) AS n FROM processing_queue WHERE progress_key LIKE 'run-%' OR progress_key LIKE 'translate-run-%' GROUP BY job_type, status"
```

**Health / cấu hình LLM hiện tại:**
```powershell
Invoke-RestMethod "$B/api/health"
Invoke-RestMethod "$B/api/llm-config"
```

**Xem log worker thật** (hữu ích nếu batch lỗi lại):
```powershell
cd "C:\Temp\cfl-export-20260720-1442\worker"; npx wrangler tail cfl-feedback-worker --format pretty
```

## Gotcha quan trọng (còn hiệu lực, cộng thêm phiên này)

- **Nút "Phân tích lại"/"Dịch lại" phải gửi `force`** — nếu sau này sửa code frontend, đừng vô tình bỏ mất tham số này, nó sẽ quay lại thành no-op im lặng y hệt bug vừa fix.
- **`prompt_version` KHÔNG phải bằng chứng LLM đã chạy** — nó chỉ là version của PROMPT, không phải của "provider đã tạo ra dòng này". Muốn biết có thật sự là LLM hay fallback, kiểm tra `summary` rỗng + `confidence=0.35` đồng thời (chữ ký của `classifyFallback`).
- **Batch size 20 là kết quả đo lường thật, đừng tăng lại 50** nếu chưa có lý do rõ ràng — sẽ làm run đứng im (mỗi batch "started" không bao giờ "completed").
- **`STALE_RUNNING_MS` = 3 phút, đo bằng log mới nhất của job** (không phải `started_at`/`updated_at` đơn thuần) — đừng sửa về cách đo cũ, sẽ làm job "còn sống" giả tạo kéo dài mãi mãi.
- **Endpoint drain đồng bộ `POST /api/processing/drain` có "takeover window" 20s** — nó có thể chiếm lại job đang `running` nếu không có log mới trong 20s, để tránh deadlock với drain qua `waitUntil` (drain chết giữa chừng vẫn kịp ghi log "started" trước, làm job trông "còn sống" với cửa sổ stale 3 phút cũ).
- **`llm_provider_secrets` là bảng MỚI, của migration `0012`** — endpoint/key của `openai_viax` nằm ở đây, không còn ở `llm_agent_configs`. Nếu cần đổi key `agent-shop`, sửa bảng này.
- **Lỗi hiển thị "0/0 comment" trên UI cho job đang xếp hàng chưa được claim** — xem mục F ở trên. Không phải bug chạy sai, chỉ là hiển thị gây hiểu lầm. Chưa sửa, đợi 33 run chạy xong.
- Các gotcha cũ (Drive/G:/C:\Temp, Pages cache, D1 bound param 90, xlsx CVE, git trên Drive) vẫn đúng nguyên — xem lịch sử bên dưới.

## Cấu hình LLM (sau refactor)

- Suy luận (phân tích comment, taxonomy discovery, game-mode verify, Insight/Report): mặc định `openai_viax` / `gpt-5.6-terra`.
- Đơn giản (dịch zh-CN): mặc định `gemini_viax` / `ag/gemini-3-flash-agent`.
- Fallback tự động: bất kỳ provider nào lỗi → thử `gemini_viax` → mọi thất bại hết mới về keyword/copy-nguyên-văn.
- Sửa qua UI: nút "Cấu hình LLM Agent" trong Ingest Settings, hoặc `PUT /api/llm-config/:slot {provider, model}` (chỉ nhận 2 provider "by Viax", provider "chính chủ"/"custom" từ chối lưu — lỗi rõ ràng nếu thử).

---

## LỊCH SỬ các session/phiên trước

### Phiên 1, cùng ngày 2026-07-29: Token metering + fix upload CSV 2 lần

- Fix upload CSV Facebook lớn bị vượt 1000 subrequest/invocation (commit `c32e9ed`) — dedupe/post lookup chuyển từ chunk `IN(...)` sang quét DB theo khoảng ngày/prefix.
- Bật token usage tracking: provider trả `{content, usage}` thay vì string thuần (`e0a5a57`), aggregate theo run + theo khoảng ngày (`e8e36e3`), hiển thị UI trong Lịch sử Ingest (`f0eb349`).
- Bỏ upload CSV 2 lần: preview parse ngay trên browser thay vì gọi API preview rồi gọi API upload (`5313260`).
- Phát hiện "G:" trên máy này là ổ local, không phải Google Drive — đã ghi vào MEMORY và handoff.

### Session 2026-07-23: taxonomy game-mode + UI lịch sử ingest

9 mode curated dưới `gameplay_mode_map`. Route `POST /api/game-modes/tag`, idempotent, 2 bước keyword + LLM verify. Đã chạy full trên production 2026-06-29→2026-07-23 (811 tag). UI lọc nguồn + phân trang trong Lịch sử Ingest.

### Session 2026-07-20: tính năng Xuất Excel comment

Xuất comment ra Excel theo nguồn + khoảng thời gian + chủ đề. Backend `commentFilters.ts`, frontend `ExcelExportDialog`.
