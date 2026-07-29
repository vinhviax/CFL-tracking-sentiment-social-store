# HANDOFF 2026-07-29 (phiên 2 — refactor LLM provider + fix pipeline)

Bàn giao cho agent/session tiếp theo của project **CFL Feedback Intelligence**.
(Phiên trước trong cùng ngày — token metering + fix upload CSV — nằm trong mục lịch sử bên dưới. Các session cũ hơn nằm sau cùng.)

## ✅ ĐÃ HOÀN TẤT: 100% comment đã có phân tích LLM thật (đêm 29→30/07)

**Toàn bộ 58.718 comment cần phân tích lại đã xong.** Tiến độ đo được qua nhiều lần kiểm tra (số comment còn là fallback từ khóa):

```
58.718 → 58.500 → 58.180 → 57.920 → 54.898 → 53.898 → 53.535
→ 21.279 → 1.001 (mắc kẹt do bug — xem mục G, đã fix)
→ 981 → 20 (1 batch lỗi tức thời cả 2 provider) → 0
```

**Xác nhận chất lượng cuối cùng trên toàn bộ bảng `analyses`** (không chỉ 33 run, toàn bộ DB):
- `summary` rỗng: **0** dòng (trước đây 59.034 dòng rỗng)
- Số mức `confidence` khác nhau: **88** (trước đây tất cả đều đúng `0.35`)
- `confidence` trung bình: **0.839**, dao động 0.1–1.0

Trong lúc chạy, **phát hiện thêm 1 bug quan trọng và đã fix** (mục G): cơ chế "force re-chạy" bị mắc kẹt vĩnh viễn vì `started_at` của job không bao giờ reset khi re-force — đã fix + deploy (commit `2f497e3`), viết test, verify trên production.

## ⚠️ VIỆC CÒN DANG DỞ: dịch lại 22.783 summary zh-CN — ĐANG BỊ CHẶN BỞI RATE LIMIT

Phát hiện thêm: **22.783 comment** có summary tiếng Việt thật (mới, sau khi phân tích lại) nhưng bản dịch summary zh-CN vẫn RỖNG — vì bản dịch cũ được tạo từ lúc summary tiếng Việt còn rỗng (trước khi có phân tích LLM thật), và việc "Phân tích lại" xong không tự động kéo theo dịch lại summary. Đây **không phải lỗi nghiêm trọng** — dữ liệu phân tích (chủ đề/sentiment/urgency) đã đúng 100%, chỉ có cột hiển thị tiếng Trung của riêng phần summary là chưa cập nhật.

Đã kích hoạt dịch lại đúng 22.783 ID này (chia 6 lô theo `comment_ids`, tránh đụng phần đã đúng). Tiến độ: 22.783 → 18.103 (giảm 4.680) rồi **đứng yên hoàn toàn** — không phải bug code, mà là **rate limit thật từ proxy `antigravity/gemini-3-flash-agent`** (hạ tầng đứng sau `gemini_viax`): mọi batch đều trả về lỗi `HTTP 403 "reset after Ns"` (N dao động 19–44 giây tùy lần thử). Đã thử:
- Chờ 90s → vẫn lỗi.
- Hạ `LLM_BATCH_CONCURRENCY` từ 5 xuống 2 (commit `0b8af57`, deploy `a53cceef`) + chờ 240s hoàn toàn không gửi request nào → **vẫn lỗi**, dù số giây "reset after" giảm dần qua các lần thử (44s→37s→19s), gợi ý đây có thể là quota theo phút của proxy, không đơn thuần là số request đồng thời.

**Đã DỪNG chủ động retry dồn dập** để tránh làm nặng thêm — đang để cron 5 phút (giờ chạy với concurrency đã hạ) tự thử nhẹ nhàng theo thời gian. Khi bạn vào lại:

1. Kiểm tra còn bao nhiêu comment còn summary zh-CN rỗng:
   ```sql
   SELECT COUNT(*) FROM comments c JOIN analyses a ON a.comment_id=c.id
   JOIN comment_translations t ON t.comment_id=c.id AND t.locale='zh-CN'
   WHERE c.skipped_analysis=0 AND TRIM(COALESCE(a.summary,''))!='' AND TRIM(COALESCE(t.summary_translated,''))='';
   ```
   Mốc cuối đo được: **18.103**.
2. Nếu số này đã giảm (dù chỉ vài trăm), nghĩa là rate limit đã tự hồi phục qua đêm — cron đang xử lý tiếp, cứ để nó chạy hoặc chạy thêm vòng lặp drain nếu muốn nhanh hơn.
3. Nếu vẫn đứng yên y hệt 18.103, rate limit chưa hồi phục — kiểm tra log thật bằng `npx wrangler tail` để xem còn lỗi 403 không. Nếu còn, đây là vấn đề phía nhà cung cấp proxy `agent-shop`/`antigravity`, không phải bug trong code — có thể cần liên hệ người quản lý proxy đó, hoặc đợi lâu hơn nữa, hoặc cân nhắc đổi tạm slot "Đơn giản" sang provider khác (xem UI Cấu hình LLM Agent) cho riêng đợt dịch lại này.
4. Việc này **không khẩn** — dữ liệu phân tích chính đã hoàn thiện 100%, đây chỉ là hoàn thiện thêm phần hiển thị tiếng Trung.
5. **Có thể sửa lỗi hiển thị UI ghi ở mục F bên dưới bất cứ lúc nào** — không cần chờ việc dịch lại summary xong, hai việc độc lập nhau.

**Danh sách 33 run đã kích hoạt ban đầu** (analysis + translation, force=true), ID:
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

### G. Bug nghiêm trọng: cơ chế "force re-chạy" tự mắc kẹt vĩnh viễn — ĐÃ FIX (commit `2f497e3`)

**Phát hiện lúc nào**: đêm 29→30/07, sau khi 33 run kích hoạt ban đầu đã giảm số fallback từ 58.718 xuống 21.279 rồi xuống 1.001 — nhưng sau đó **đứng yên tuyệt đối ở 1.001** dù chạy thêm 300 lần drain. Đào sâu phát hiện: log lỗi mới nhất của run-47 dừng ở `19:17`, dù tôi đã re-force nó nhiều giờ sau — nghĩa là lần re-force đó **không hề chạm** vào các comment còn lại.

**Nguyên nhân gốc** (bug tôi tự gây ra khi viết cơ chế `forceSince` ở mục E): khi bấm "Phân tích lại" trên 1 run **đã từng chạy xong** (progress_key trùng, vd `run-47`), hàm `enqueueJobs` chỉ có `ON CONFLICT DO UPDATE` reset `status`/`error`, **không reset `started_at`**. Mà `started_at` chính là `forceSince` — mốc cutoff để quyết định comment nào "còn cần xử lý" (`analyzed_at < forceSince`). Vì `started_at` dùng `COALESCE(started_at, ?)` khi claim — chỉ set 1 lần duy nhất trong toàn bộ vòng đời của progress_key đó, không bao giờ đổi sau đó.

**Hệ quả tai hại**: giả sử run-47 được kích hoạt lần đầu lúc 15:53. Batch nào đó lỗi cả 2 provider (`openai_viax` lẫn `gemini_viax` fallback safety net) → rơi về keyword fallback lúc 19:17, ghi `analyzed_at = 19:17`. Nếu bạn bấm "Phân tích lại" run-47 một lần nữa vào lúc 21:00, hệ thống dùng lại `forceSince = 15:53` (KHÔNG đổi) — mà `19:17 > 15:53`, nên điều kiện `analyzed_at < forceSince` là SAI với đúng comment vừa fallback đó → nó bị coi là "đã xử lý trong phiên force này rồi", **bỏ qua vĩnh viễn**, dù thực chất chưa từng được LLM phân tích thật. Không có cách nào bấm lại nút để sửa — nó sẽ mãi mãi bỏ qua đúng những comment cần sửa nhất.

Đây chính là lý do 1.001 comment (rải ở run #99, #47, #53, #59, #61, #67, #75, #83, #73) đứng yên không nhúc nhích dù chạy drain bao nhiêu lần.

**Cách fix**: sửa `ON CONFLICT DO UPDATE` trong `worker/src/services/processingQueue.ts` (`enqueueJobs`) — chỉ reset `started_at = NULL` và `attempts = 0` khi row đang ở trạng thái **terminal** (`done`/`failed`/`cancelled`); nếu job đang `queued`/`running` thật sự (active) thì GIỮ NGUYÊN baseline của nó (tránh xáo trộn 1 job đang chạy dở). Đã viết 4 test mô phỏng đúng hành vi `ON CONFLICT` bằng D1 giả lập thật (`fakeQueueDb` trong `processingQueue.test.ts`), verify trên production: `started_at` của run-47 nhảy từ `2026-07-29T15:53:57Z` (đông cứng) sang timestamp mới sau khi re-force với code đã fix.

**⚠️ Hệ quả phụ phát hiện ngay sau khi fix — ĐỪNG re-force theo `run_id` cho run đã chạy xong:** sau khi deploy fix, tôi re-force lại theo `run_id` cho 9 run bị kẹt (`{"run_id":47,"force":true}`) — nhưng vì `forceSince` giờ luôn là mốc MỚI (do `started_at` đã reset đúng), điều kiện `analyzed_at < forceSince` lại đúng với **TẤT CẢ** comment trong run, kể cả hàng chục nghìn dòng **đã phân tích LLM thành công từ trước**. Log cho thấy run-47 định chạy lại **715 batch** (~14.300 comment, gần như toàn bộ run 14.482 comment) chỉ để sửa 300 dòng thật sự bị kẹt — tốn token gấp hàng chục lần không cần thiết. **Đã phát hiện và HỦY kịp thời** (`POST /api/processing/jobs/:id/cancel`) trước khi tốn nhiều — thiệt hại thực tế đo được chỉ ~20 comment bị làm lại thừa (1.001→981).

**Cách xử lý ĐÚNG đã áp dụng**: lấy chính xác danh sách `comment_ids` còn kẹt (981 dòng) bằng query D1, rồi gọi `POST /api/analyze/run` và `POST /api/translate/run` với `{"comment_ids":[...981 id...],"force":true}` — **KHÔNG kèm `run_id`**. Khi không có `run_id`, `progress_key` là `adhoc-<timestamp>` duy nhất mỗi lần gọi, nên job chỉ xử lý đúng đúng các ID được liệt kê, không đụng tới phần còn lại của run. Đây là cách an toàn để "sửa nốt vài dòng lẻ" mà không tốn công/token phân tích lại cả run.

**Quy tắc rút ra — RẤT QUAN TRỌNG cho tương lai**:
- Nếu 1 run **đã từng phân tích xong hoàn toàn 1 lần** (kể cả với vài dòng fallback lẻ tẻ), **ĐỪNG bấm "Phân tích lại" theo `run_id` nữa** — nó sẽ luôn re-scan lại TOÀN BỘ run (đây là hệ quả tất yếu của cơ chế `forceSince`, không phải bug, nhưng rất tốn token nếu run lớn).
- Muốn sửa vài dòng còn sót (do LLM thật sự lỗi ở đúng dòng đó), luôn dùng `comment_ids` cụ thể + `force:true`, KHÔNG kèm `run_id`.
- Nút "Phân tích lại"/"Dịch lại" trên UI hiện tại vẫn dùng `run_id` — nếu user bấm nút đó trên 1 run to đã từng hoàn thành, nó sẽ re-scan lại cả run. Đây là **giới hạn đã biết**, cân nhắc thêm cảnh báo trên UI hoặc route riêng cho "sửa vài dòng lẻ" nếu việc này xảy ra thường xuyên.

**Đã làm sau khi fix + phát hiện hệ quả phụ**: deploy fix (Version `398d1796...`), enqueue targeted `comment_ids` (981 ID chính xác) cho cả analyze và translate (progress_key `adhoc-1785361533546` và `translate-1785361549224`), khởi động vòng lặp drain nền 40 lần (khối lượng nhỏ, nên nhanh). Cần kiểm tra kết quả khi đọc handoff này — xem số liệu ở mục "VIỆC ĐANG CHẠY" đầu file.

**Bài học nếu viết lại cơ chế "force" cho chỗ khác trong tương lai**: đừng dùng mốc thời gian cố định (`started_at`/`forceSince`) làm điều kiện hội tụ nếu bản thân quá trình xử lý có thể **ghi lại `analyzed_at` mới** cho đúng những dòng chưa xử lý thành công (như fallback). Cách an toàn hơn: theo dõi rõ ràng "đã thử qua LLM thật trong phiên force này chưa" bằng 1 cột/giá trị riêng (không dùng timestamp so sánh), hoặc đảm bảo baseline luôn được refresh mỗi khi có ai chủ động bấm "chạy lại".

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
- **`enqueueJobs` phải reset `started_at`/`attempts` khi re-enqueue 1 job đang ở trạng thái terminal** (xem mục G) — nếu sau này sửa lại SQL `ON CONFLICT` của bảng `processing_queue`, đừng bỏ mất phần reset này, nếu không "force re-chạy" sẽ lại mắc kẹt vĩnh viễn giống hệt bug đã fix đêm 29→30/07.
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
