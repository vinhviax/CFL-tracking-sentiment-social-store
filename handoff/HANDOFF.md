# HANDOFF — CFL Feedback Intelligence

Bàn giao tiến độ cho agent/session tiếp theo. Kiến trúc, config, secrets, gotcha kỹ thuật nằm ở `MEMORY.md` — file này chỉ ghi **tiến độ và việc cần làm tiếp**, không lặp lại giải thích kiến trúc.

## 🔴 Trạng thái tại 2026-09-03 (phiên 7) — CODE ĐÃ PUSH NHƯNG CHƯA DEPLOY, production đang lỗi

**Việc đầu tiên phải làm khi mở máy: chạy 2 lệnh dưới đây, đúng thứ tự này.** Quota D1 reset lúc **00:00 UTC = 07:00 sáng GMT+7**. Trước giờ đó thì cả 2 lệnh đều fail.

```bash
cd worker
npx wrangler d1 migrations apply cfl-feedback --remote   # BẮT BUỘC chạy trước
npx wrangler deploy                                       # chỉ chạy sau khi lệnh trên xong
```

**Tuyệt đối không deploy trước khi migration xong.** Code mới trong `routes/runs.ts` ghi vào các cột chỉ tồn tại sau migration `0018`; deploy trước sẽ làm `/api/runs` trả 500 ngay cả khi quota đã reset. Migration `0017` sẽ đọc ~487k dòng để dựng index và `0019` đọc ~87k — tốn khoảng 11% quota ngày, một lần duy nhất, đây là bình thường.

Sau khi deploy, verify: `Invoke-RestMethod ".../api/health"` phải trả `status: ok`, rồi mở trang Ingest và kiểm tra cột "Phân tích"/"Dịch" vẫn hiện đúng số như trước.

### Chuyện gì đã xảy ra

Production trả **HTTP 500 toàn bộ** ngày 2026-09-03. Nguyên nhân: D1 báo `exceeded free tier daily row read limit` (5 triệu dòng/ngày, code 7500). `/api/meta` vẫn sống vì không đụng D1 — đó là cách phân biệt nhanh lỗi loại này.

Đo thật: **một lần mở trang Ingest tốn ~1 triệu dòng đọc D1**, nên chỉ 5 lần mở là hết quota ngày. Bốn nguyên nhân, đã sửa cả bốn trong commit `c9c892a`:

1. **`routes/runs.ts` tính lại toàn bộ số đếm mỗi request** — 5 subquery tương quan cho mỗi run, với `limit: 500` từ frontend → quét 87.500 comment 5 lượt + join sang `analyses`/`comment_translations` ≈ **600k dòng/request**, và tăng vĩnh viễn theo lượng dữ liệu. Thay bằng cột cache trên `ingest_runs` (migration `0018`) + `services/runCounters.ts`: chỉ đếm lại run nào còn việc đang chạy. **Điểm quan trọng nhất không phải con số hôm nay mà là chi phí không còn tăng theo dữ liệu** — với 300k comment thì code cũ sẽ ngốn hết quota chỉ trong 1 lần mở trang.
2. **`tokenUsage.ts` quét cả 487k dòng `processing_logs`** dù chỉ ~18k dòng khớp `level='success' AND phase='llm_batch'`. Thêm partial index đúng predicate đó (migration `0017`) — không đổi code, không đổi UI.
3. **`/api/ingest/status` dùng `MAX(SUBSTR(created_at,1,10))`** làm index vô dụng → quét cả bảng `comments` mỗi lần mở trang. Đổi sang `MAX(created_at)` rồi cắt 10 ký tự ở JS + index `(source_type, created_at)` (migration `0019`).
4. **Bug `ctx.waitUntil` từ phiên 6 (mục A đã hoãn) — nay đã sửa.** `scheduled()` giao việc cho `ctx.waitUntil` rồi return ngay, Cloudflare hủy task sau ~30s giữa lúc gọi LLM (batch mất 25-35s) → job treo `running`, 3 phút sau bị thu hồi, chạy lại từ batch 1, **lặp vô hạn suốt 3 tuần**: vừa không bao giờ xong (đó là lý do "rất nhiều task chưa dịch/phân tích") vừa đốt quota đọc. Đổi sang `await` trực tiếp. CPU đo được chỉ ~113ms nên không chạm giới hạn CPU.

Test: worker **316/316** pass, `tsc --noEmit` sạch, frontend **68/68** pass.

### Cảnh báo: J: đang lỗi git

`J:\My Drive\CFL\Agent\Tracking Store Social` trả `error: bad tree object HEAD` (exit 128) khi `git status`, lặp lại được — đúng cảnh báo có sẵn trong MEMORY về git trên Google Drive. `git rev-parse HEAD` vẫn ra `6fe15f5` nhưng không commit được. **Phiên 7 đã làm code và commit/push từ G:** (clone thật trên ổ local, sạch). J: giờ đã lạc hậu 1 commit — cần `git pull` hoặc clone lại; nếu vẫn lỗi thì nên coi G: là workspace chính từ nay.

## Trạng thái tại 2026-08-14 (cuối phiên 6) — có sửa code, đã deploy production

- Commit mới nhất: `0db5f89` trên `origin/main`, working tree sạch tại J:.
- **Đã deploy Worker 2 lần trong phiên này**: version `b0cd427f` (11:33:24 UTC) là bản đang chạy production — đổi model `gemini_viax` + xóa `limits.cpu_ms`. Đã chạy migration `0016` trên D1 remote.
- Test/typecheck đã chạy lại sau mọi thay đổi: worker 300/300 pass, `tsc --noEmit` sạch, frontend 68/68 pass (chạy bằng `node --test`, không phải `npm test` — xem mục gotcha bên dưới).
- **Chưa deploy lại frontend** trong phiên này — không có thay đổi frontend nào.

## 🎯 Việc quan trọng nhất cần biết khi mở máy ở nhà

**Tài khoản Cloudflare đang là Free plan** (phát hiện 2026-08-14 khi deploy bị Cloudflare từ chối thẳng: `"CPU limits are not supported for the Free plan"`). Đã xóa `limits.cpu_ms: 60000` khỏi `worker/wrangler.jsonc` để deploy được — quay lại giới hạn CPU mặc định 30 giây/invocation. Chi tiết + rủi ro xem `MEMORY.md` mục "Cloudflare config". **Nếu deploy tối nay ở nhà cũng bị lỗi tương tự, đây không phải lỗi mới — kiểm tra lại `git log -1 -- worker/wrangler.jsonc` để chắc bản ở nhà đã có commit `0db5f89`.**

## Việc đã làm phiên 6 (2026-08-14)

User báo "Ingest #133 đứng yên hoàn toàn", đồng thời nhờ đổi key Sensor Tower đã hết hạn. Diễn biến:

1. **Đổi key Sensor Tower** (`SENSORTOWER_API_KEY`, user tự chạy `wrangler secret put`) — key cũ đã hết hạn khiến cron kéo Store fail 401 liên tục **6 ngày** (`run #118` → `#128`, 2026-08-08 → 08-13), cursor `sensortower_store` bị kẹt ở `2026-08-07`.
2. **Backfill 1 lần** qua `POST /api/ingest/sensortower {start_date:"2026-08-08", end_date:"2026-08-14"}` (endpoint admin, cần `X-CFL-Admin-Key`) → `run #134`: 223 dòng, 221 mới, cursor đã đẩy lên `2026-08-14`. Run #134 đã **phân tích + dịch xong 100% (221/221)**.
3. **Chẩn đoán gốc vụ run #133 đứng yên** (16.429 comment Facebook CSV, 0% tiến độ suốt ~40 phút trước khi sửa): dùng `wrangler tail --format json` bắt được bằng chứng trực tiếp từ Cloudflare — cảnh báo `"waitUntil() tasks did not complete within the allowed time after invocation end and have been cancelled"` trên các invocation dài đúng **~30.05 giây**, CPU chỉ ~113ms (không phải hết CPU, hết wall-clock của `ctx.waitUntil`). Đo thêm bằng `POST /api/processing/drain` (đường đồng bộ, không qua `waitUntil`) chạy thật 71.8 giây liên tục → suy ra **1 batch phân tích qua `gpt-5.6-terra` (openai_viax) mất ~25–35 giây/batch**, sát/vượt ngưỡng 30 giây mà Cloudflare cho `ctx.waitUntil` sống sau khi trả response. Mọi lần chạy nền (cron 5 phút, poll từ UI) đều bị cắt giữa batch → không kịp ghi log completed lẫn failed → job bị coi là "treo" sau 3 phút (`STALE_RUNNING_MS`) → khởi động lại từ batch 1 → lặp vô hạn không tiến triển. **User đã xin hoãn fix gốc (đổi `ctx.waitUntil` thành `await` trực tiếp trong `scheduled()`) để mai test lại — CHƯA SỬA CODE cho vấn đề này.**
4. **Đổi model `gemini_viax`** từ `ag/gemini-3-flash-agent` sang `ag/gemini-3.6-flash-high` (yêu cầu riêng của user, không liên quan vụ treo). Sửa: `worker/src/services/llmCatalog.ts` (model đầu danh sách + default slot `simple`), `worker/src/services/llmAgentConfig.ts` (`SLOT_SECONDARY.reasoning`), thêm migration `worker/migrations/0016_gemini_viax_flash_high.sql` để UPDATE dòng đã seed sẵn trong D1 (đổi catalog code không đủ — tiền lệ `0013`). Model cũ vẫn còn trong danh sách chọn để revert nhanh từ UI nếu cần. Đã TDD (test đỏ trước, xanh sau), verify bằng `processing_logs` thật: 9 batch thành công (~10s/batch, nhanh hơn hẳn model cũ), 3 batch lỗi "0/20 qua LLM" (tự retry, không mất dữ liệu) — tỷ lệ lỗi ~25% batch đầu, **cần theo dõi thêm ở diện rộng hơn**, chưa rõ có phải hiện tượng thoáng qua hay đặc điểm của model mới.
5. **Gỡ chặn deploy do Free plan** (xem mục trên) — xóa `limits.cpu_ms` khỏi `wrangler.jsonc`, user đã đồng ý đánh đổi (xem MEMORY.md).
6. Nhờ leo thang tự động sang Gemini (do OpenAI đang chậm/bận), run #133 **đang chạy thật** dù chưa sửa vụ `waitUntil` — cuối phiên đạt khoảng **3.940/16.429 đã phân tích** (~24%), dịch chưa bắt đầu (đợi phân tích xong do thiết kế hàng đợi chặn translation cùng run). Cần xem lại tiến độ khi tiếp tục.

## 🎯 Việc đầu tiên cần làm phiên sau — 2 lựa chọn, ưu tiên theo ý user

**A. Fix `ctx.waitUntil` 30 giây (mới phát hiện phiên 6, user xin hoãn qua hôm sau):**
Đổi `scheduled()` trong `worker/src/index.ts` — 3 dispatch hiện dùng `ctx.waitUntil(...)` rồi return ngay (dòng ~117-125). Đổi `sweepProcessingQueue` (ít nhất) sang `await` trực tiếp để invocation không kết thúc sớm, tránh bị Cloudflare cắt ở mốc 30 giây. Bằng chứng đầy đủ + số đo đã ghi ở mục "Việc đã làm phiên 6" bên trên. **Rủi ro cần cân nhắc trước khi sửa**: 1 lượt cron có thể chạy thật vài phút nếu backlog lớn; cần kiểm tra Cloudflare có serialize Cron Trigger theo lịch hay không (tránh 2 lượt cron chồng nhau gọi LLM trùng lặp) trước khi deploy.

**B. `pendingTranslations` không chọn lại comment dịch dở dang (kế thừa từ phiên 3, vẫn chưa sửa — xem `worker/src/services/translation.ts:41`):**
Vẫn y nguyên như các phiên trước, xem MEMORY.md mục "Luu y bug/han che da gap". Chưa ai sửa qua 4 phiên liền.

## Gotcha mới phiên 6

- Frontend **không có script `npm test`** trong `package.json` — chạy test bằng `node --test src/pages/*.test.js` (Node's built-in test runner, ES modules thuần, không cần build step). Đừng chạy `npm test` rồi tưởng frontend không có test.
- `wrangler tail --format json` cho log máy đọc được (wallTime, cpuTime, exceptions, logs) — hữu ích hơn `--format pretty` khi cần chẩn đoán treo/lỗi runtime thật sự thay vì chỉ xem request nào gọi tới.
- Đã dùng `npx wrangler d1 execute cfl-feedback --remote --json --command "..."` để đọc trực tiếp bảng `llm_slot_state`/`llm_agent_configs`/`processing_logs` trên D1 production khi cần chẩn đoán sâu hơn API cho phép — an toàn vì chỉ SELECT.

## Trạng thái tại 2026-07-31 (cuối phiên 5), chỉ thêm docs, không đổi code chạy

- Commit mới nhất: `a410629` trên `origin/main`, working tree sạch, đã `git fetch` xác nhận J: khớp 100% với remote (0 commit lệch cả 2 chiều).
- Phiên 5 **không sửa code worker/frontend**, chỉ thêm 2 file tài liệu — nên **không cần deploy lại**. Worker/Pages production vẫn đang chạy đúng code của `120ee66` (deploy ở phiên 4), chưa deploy gì mới trong phiên 5.
- Test/deploy gần nhất vẫn là kết quả phiên 4: worker 300/300, frontend 98/98, `tsc --noEmit` sạch. Không chạy lại trong phiên 5 vì không có thay đổi code cần verify.

## Việc đã hoàn tất phiên 5 (2026-07-31)

User có nhu cầu **gửi repo GitHub này cho một đội dev khác để họ migrate hệ thống sang hạ tầng khác** (ví dụ Dokploy, rời khỏi Cloudflare). Đã làm:

1. **Soát bảo mật toàn bộ lịch sử git** (mọi commit, mọi branch — không chỉ code hiện tại, vì `.gitignore` chỉ chặn tương lai) trước khi xác nhận an toàn để gửi:
   - `.env`/`key_api.env` chưa từng bị commit ở bất kỳ đâu.
   - Không có API key/token thật nào trong toàn bộ lịch sử diff (chỉ có giá trị giả trong test, kiểu `"k"`, `"sk-secret-value"`).
   - `wrangler.jsonc` chỉ có tham số không nhạy cảm, không có secret.
   - Không có file data thật (`.csv`/`.xlsx`/`.db`) bị track.
   - Repo trên GitHub là **private**.
   - **2 file HTML** trong `Demo Report/` là báo cáo sentiment thật đã bị commit (không phải secret, nhưng là dữ liệu nghiệp vụ thật) — user đã biết, quyết định giữ nguyên, chưa yêu cầu xóa.
   - Toàn bộ secret thật (`ADMIN_PASSWORD`, `LLM_VIAX_API_KEY`, `FB_ACCESS_TOKEN`, `SENSORTOWER_API_KEY`) chỉ nằm trong Cloudflare Secrets Store, không đi kèm git — nếu bên migrate cần giá trị thật, user phải tự gửi riêng qua kênh khác.
   - Đã giải thích cho user: `.claude/launch.json` (đã track trong git) chỉ là config dev-server-launcher của Claude Code, vô hại, đổi tên/xóa không ảnh hưởng gì tới app. 3 branch `codex/*` (`origin/codex/sensortower-zh-workspace`, `codex/cursor-catchup-verify`, `codex/llm-concurrency-verify`) là dấu vết dùng OpenAI Codex CLI trước đây trên repo này, không có commit nào mới hơn `main`, an toàn, có thể xóa cho gọn nếu muốn (user chưa yêu cầu xóa).
2. **Viết `README.md`** (mới hoàn toàn, trước đó repo không có README nào ở root/worker/frontend/backend) — tổng quan kiến trúc, nguồn dữ liệu, luồng xử lý, cấu trúc thư mục, chạy local, biến môi trường, database/migrations, LLM provider, khóa admin, test, deploy, taxonomy, giới hạn kỹ thuật. Đã cập nhật `AGENT.md` thêm README.md vào danh sách file Markdown được phép giữ.
3. **Viết `MIGRATION.md`** — hướng dẫn kỹ thuật cho đội dev ngoài migrate rời Cloudflare (ví dụ Dokploy): bảng ánh xạ từng Cloudflare primitive (Worker runtime, D1, `ExecutionContext.waitUntil`, Cron Triggers, Pages, secrets) sang tương đương tự host, kiến trúc đề xuất, checklist 8 bước, và mục rủi ro (mạng có gọi được LLM proxy hiện tại từ hạ tầng mới không, D1 không có transaction đa-statement thật, `backend/` FastAPI cũ không phải lựa chọn thay thế sẵn sàng). Đã xác nhận bằng code thật: worker chỉ dùng đúng 2 API đặc thù Cloudflare (D1 + `waitUntil`), không có KV/R2/Queues/Durable Objects nào khác — phạm vi migrate hẹp hơn tưởng tượng ban đầu. Cũng cập nhật `AGENT.md` thêm MIGRATION.md vào danh sách file được phép giữ.
4. User đã thử endpoint LLM nội bộ VNG `https://lite-aawp.vnggames.net` (xem phiên trước) — quyết định không dùng, giữ nguyên `openai_viax`/`gemini_viax`. Không có thay đổi code liên quan.

## Workflow làm việc đa ổ đĩa (quan trọng, áp dụng từ phiên 4)

- **Sửa code + `git commit` + `git push`**: làm ở `J:\My Drive\CFL\Agent\Tracking Store Social` (canonical, git thuần chạy bình thường trên Google Drive).
- **Chạy lệnh nặng** (`npm install`, test, build, `wrangler deploy`/`pages deploy`): J: bị treo vô hạn hoặc Windows không nhận diện được binary thực thi qua Google Drive. Thay vào đó sync `G:\CFM\Research\Crossfire Legends Sea` (ổ local, đã là git clone thật) bằng `git checkout main && git pull origin main --ff-only`, cài lại dependency nếu `package.json` đổi, rồi chạy lệnh ở đó. Xong quay lại J: sửa code tiếp — không sửa code trực tiếp trên G:.
- Chi tiết đầy đủ đã lưu vào memory `cfl-run-tests-from-local-mirror`.

## Việc còn để ngỏ, chưa làm (không khẩn)

- Hiển thị vị trí hàng đợi dạng danh sách tổng quan hơn.
- Tách 2 run siêu lớn thành job nhỏ hơn để không chiếm slot liên tục — thay đổi kiến trúc, cần bàn với user trước.
- `worker/src/services/llm/fallback.ts` (`classifyFallback`) vẫn là code chết (không còn được `classifier.ts` gọi) — có thể xoá nếu muốn dọn dẹp, chưa làm.
- `wrangler dev` (local dev server) hiện lỗi `Incorrect type for map entry 'DAILY_INGEST_CRON'` — do `index.ts` export thêm hằng/hàm ngoài default export, bản wrangler 4.107 không chấp nhận kiểu export đó cho local dev (không ảnh hưởng `wrangler deploy`/production). Chưa sửa, không khẩn vì không cản deploy.
- 3 branch `codex/*` (xem mục "Việc đã hoàn tất phiên 5") vẫn còn trên repo — an toàn, có thể xóa cho gọn nếu user yêu cầu, chưa tự ý xóa.
- `.claude/launch.json` vẫn giữ tên gốc — user đang cân nhắc đổi tên, chưa quyết định, chưa làm.
- 2 `ingest_run` mồ côi kẹt ở trạng thái `running` vĩnh viễn, chưa dọn: `#104` (2026-08-01, source `store`) và `#130` (2026-08-14, source `store`, trước khi tạo run #134) — cùng họ triệu chứng với vụ `ctx.waitUntil` 30 giây (job chết giữa chừng, không kịp ghi `failed`). Không ảnh hưởng dữ liệu hiển thị, chỉ là rác trong bảng `ingest_runs`; có thể dọn bằng `DELETE /api/runs/:id` (admin) sau khi xác nhận không còn `processing_queue` job nào tham chiếu.
- Tỷ lệ lỗi parse ~25% batch đầu của model `ag/gemini-3.6-flash-high` (xem phiên 6) — cần theo dõi thêm trên diện rộng hơn 12 batch quan sát được, chưa đủ dữ liệu để kết luận đây là bình thường hay cần điều chỉnh prompt/retry.
