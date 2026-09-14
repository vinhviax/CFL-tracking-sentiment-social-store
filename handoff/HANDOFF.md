# HANDOFF — CFL Feedback Intelligence

Bàn giao tiến độ cho agent/session tiếp theo. Kiến trúc, config, secrets, gotcha kỹ thuật nằm ở `MEMORY.md` — file này chỉ ghi **tiến độ và việc cần làm tiếp**, không lặp lại giải thích kiến trúc.

## 🎯 Trạng thái tại 2026-09-14 (cuối phiên) — ĐÃ CHUYỂN HẲN SANG LLM NỘI BỘ VNG

Yêu cầu: bỏ toàn bộ LLM khác, chỉ dùng gateway VNG. Đã làm xong (commit `04a973c`, `d79aed8`).

### Cấu hình LLM hiện tại

| Slot | Provider | Model | Tốc độ đo thật |
|---|---|---|---|
| `reasoning` (phân tích, Insight, taxonomy) | `vng_lite` | `gemini/gemini-3.6-flash` | 19,9s/batch 20 comment |
| `simple` (dịch zh-CN) | `vng_lite` | `gemini/gemini-3.5-flash-lite` | 4,7s/batch |

Catalog từ 7 provider còn **1**. Bỏ 2 proxy Viax + 3 endpoint "chính chủ" + `custom` — mạng này không gọi ra được domain nào trong số đó. Bring-your-own-key tắt theo (không còn provider nào `byo: true`).

### ⚠️ "Gemini 3.7 Flash" KHÔNG tồn tại trên gateway

Đã hỏi `GET /v1/models` trước khi cấu hình. Gateway chỉ có 10 model, gemini flash mới nhất là `3.6-flash`. Nếu cứ cấu hình 3.7 thì gateway từ chối và hệ thống hỏng âm thầm. **Luôn hỏi model list trước khi đổi model**, đừng đoán theo tên.

### 🔴 Bẫy đã bắt được: LLM trả `id` kiểu string → rớt sạch 100% kết quả

Sau khi chuyển sang 3.6-flash, 5 batch liên tiếp ghi `0/20 qua LLM`, không lỗi, không manh mối. Tái hiện bằng code thật gọi thẳng gateway: model trả `{"id":"255087", ...}` — **nội dung phân loại hoàn toàn đúng, chỉ `id` là string**. `validateClassification` từ chối ngay dòng đầu vì `typeof raw.id !== "number"`, trong khi mọi field khác đều có giá trị dự phòng → vứt sạch cả 20/20.

Đã sửa (`services/llm/base.ts`): nhận cả 2 kiểu, ép về number trước khi trả ra. Kiểm chứng lại bằng chính gateway thật: **20/20 qua**.

**Đã xác nhận chạy thật trên production sau khi deploy bản sửa** (09:26 UTC 14/09):

```
09:26:45 | success | 9291ms | out=1949 | Analysis batch 5/5 completed
09:26:36 | success | 9774ms | out=2005 | Analysis batch 3/5 completed
09:26:36 | success | 9432ms | out=1930 | Analysis batch 4/5 completed
```

Số comment đã phân tích tăng **85.567 → 85.787** và tiếp tục chạy. Mỗi batch 20 comment mất ~9,3–9,8 giây — nhanh hơn con số 19,9s đo hồi 04/09.

**Bài học ghi vào MEMORY**: đổi model xong phải kiểm tra có batch `success` thật trong `processing_logs`. Đừng dừng ở `/api/health` báo `ready: true` — `ready` chỉ nghĩa là "có credential", không phải "gọi được và parse được".

### Hai chi tiết vận hành mới biết

- **Autodeploy bật nhưng webhook KHÔNG bắn.** Push lên GitHub không kích hoạt deploy — mọi lần đều phải bấm Deploy tay trong UI Dokploy.
- **Gateway có cache**: gọi lại đúng body trả về trong ~100ms thay vì vài giây. Đừng nhầm tưởng batch nhanh bất thường là lỗi.

## Trạng thái tại 2026-09-14 — ĐÃ CHẠY THẬT TRÊN DOKPLOY VỚI DỮ LIỆU THẬT

**Production trên Dokploy đã sống, có dữ liệu thật.** `cfl-feedback-api` và `cfl-feedback-web` đã Deploy trên Dokploy (project `CFL / production`), domain `https://cfl-feedback-api.103.245.249.96.nip.io` — verify vừa xong:

```
GET /api/meta            -> 200
GET /api/health           -> 200
GET /api/stats/overview   -> total_comments 89378, analyzed 85567, negative_pct 30.2
```

Khớp 100% với số liệu đã xác nhận lúc export/import (mục "DỮ LIỆU ĐÃ CHUYỂN XONG SANG libSQL" bên dưới).

### Cách đưa file 98MB lên volume khi không có SSH và Dokploy không có upload UI

Dokploy **không có tính năng upload file cho volume** của Application (chỉ đổi tên/xoá mount) — đã kiểm tra hết Advanced/Volumes. Docker Terminal qua trình duyệt tự động cũng không dùng được: gõ chữ vào được nhưng phím Enter không gửi tới container để thực thi (đã thử nhiều cách, kể cả paste qua clipboard — bị chặn quyền trong sandbox).

Giải pháp đã dùng — **tạm thời thêm 1 endpoint** `POST /__node-admin/replace-db` (commit `f425ab0`), sau khi dùng xong **đã xoá sạch** (commit `119ddff`, diff xác nhận 3 file khôi phục y hệt bản trước khi thêm):

- Đảo ngược logic fail-open của các route admin khác: không đặt `ADMIN_PASSWORD` thì route này **từ chối tất cả**, khác với các route khác (mặc định mở khi chưa set secret).
- Chỉ kiểm tra 16 byte đầu là `"SQLite format 3\0"` — từ chối mọi thứ khác. Không cho chạy SQL tuỳ ý.
- Ghi ra file tạm rồi `rename` đè lên — thao tác nguyên tử.
- Bật bằng `ENABLE_DB_REPLACE=true`, mặc định tắt.

**Phát hiện lỗi thật lúc viết test** (không phải giả định): đóng kết nối libSQL rồi `rename` đè lên file đang mở vẫn `EPERM` trên Windows — dùng `global.gc()` cưỡng bức cũng không giải phóng được handle vì đối tượng client vẫn còn được tham chiếu bởi server đang chạy. Đây là giới hạn của native binding trên Windows, **không xảy ra trên Linux** (đích thật của Dokploy) vì POSIX `rename()` không quan tâm file đích đang mở bởi ai. Đã đánh dấu skip 1 test trên Windows kèm giải thích đầy đủ, không giấu lỗi đi.

⚠️ **Sự cố bảo mật đã xảy ra và đã xử lý**: lúc thao tác trên UI Dokploy, một lệnh JS đọc nhầm giá trị thật của `ADMIN_PASSWORD`, `LLM_VNG_LITE_API_KEY`, `SENSORTOWER_API_KEY` vào kết quả trả về (lộ trong transcript phiên làm việc). Đã báo ngay cho user lúc đó và **khuyến nghị rotate cả 3 key này** — chưa xác nhận đã rotate hay chưa, cần kiểm tra ở đầu phiên sau nếu liên quan tới bảo mật.

### Việc tiếp theo

1. **Xác nhận đã rotate 3 secret bị lộ** (xem cảnh báo bảo mật ở trên) — nếu chưa, nhắc user làm ngay.
2. **Deploy `cfl-feedback-web`** (frontend) nếu chưa làm — trước đó mới cấu hình, chưa xác nhận đã Deploy giống `cfl-feedback-api`.
3. **Đổi 2 slot LLM sang `vng_lite`** qua UI `/api/llm-config` — bây giờ ĐÃ chạy trên Dokploy nên an toàn để làm, không còn bẫy cutover nữa (bẫy đó chỉ áp dụng khi Cloudflare còn là production).
4. Cắt domain/DNS thật (nếu có) trỏ vào Dokploy, rồi tắt Worker + Pages trên Cloudflare.
5. Set `RUN_MIGRATIONS=false` trên Dokploy cho lần khởi động tiếp theo trở đi — không bắt buộc (idempotent) nhưng đỡ phải chạy lại 19 migration mỗi lần container restart.

## Trạng thái tại 2026-09-05 07:10 GMT+7 — DỮ LIỆU ĐÃ CHUYỂN XONG SANG libSQL

Chạy tự động theo lịch hẹn ngay sau khi quota D1 reset (00:00 UTC). Không cần người can thiệp.

### Kết quả thật

| | |
|---|---|
| Dump D1 | `C:\Temp\cfl-d1-dump-20260904` — **20 bảng, 117 MB**, xuất xong 07:06–07:08 |
| File libSQL | `C:\Temp\cfl-feedback-libsql\cfl-feedback.db` — **98 MB** (D1 báo 316 MB vì tính cả index/overhead) |
| Import | **320.330 statement trong ~37 giây**, `PRAGMA foreign_key_check`: **0 vi phạm** |
| Đối chiếu | **0 bảng lệch** — 19/19 bảng khớp `manifest.json`; `analyses` đối chiếu riêng với D1: 85.567 = 85.567 |

Số dòng từng bảng (sau import):

| Bảng | Dòng | | Bảng | Dòng |
|---|---:|---|---|---:|
| comments | 89.378 | | memory_evidence | 13.586 |
| analyses | 85.567 | | posts | 4.956 |
| comment_translations | 85.166 | | taxonomy_subtopics | 1.538 |
| comment_subtopics | 19.262 | | analyze_jobs | 426 |
| processing_logs | 19.698 | | processing_queue | 418 |
| ingest_runs | 118 | | feedback_memories | 115 |

Còn lại đều ≤ 19 dòng (`d1_migrations` 19, `saved_insights` 5, `llm_*`, `ingest_cursors`, `app_settings`).

**`comments` là 89.378 chứ không phải 87.534** — con số cũ ghi ngày 03/09, dữ liệu đã tăng thêm từ đó. Không có gì sai.

**`processing_logs` chỉ lấy 19.698 dòng có token** (`level='success' AND phase='llm_batch'`) thay vì ~487k dòng. Đây là chỗ dọn dẹp đã bàn từ phiên trước, nhưng làm theo cách khác và rẻ hơn: lọc lúc xuất thay vì DELETE trên D1. Xoá 433.865 dòng trên D1 sẽ tốn 433.865 lượt ghi trên hạn mức 100.000 ghi/ngày — **bốn ngày quota để tiết kiệm một lần dump**. Lọc lúc xuất tốn 0 đồng.

### Đã verify: app chạy thật trên DB đã nạp

Boot `dist/server.js` với `RUN_MIGRATIONS=false CRON_ENABLED=false`, đọc qua HTTP thật:

- `/api/stats/overview` → **89.378 comment, 85.567 đã phân tích, 30,2% tiêu cực**, top topic `item_skin_weapon` (14.208).
- `/api/comments?limit=5` → dữ liệu thật, tiếng Việt có dấu nguyên vẹn.
- `/api/runs?limit=5` → run 166–170.
- `/api/ingest/status` → cursor `facebook_page` và `sensortower_store` đều ở `2026-09-02`.
- Log xác nhận **không chạy migration** (đúng, vì dump đã mang schema + 19 dòng `d1_migrations`).

### Bẫy mới, đã ghi vào MEMORY

Chạy script từ Git Bash **phải dùng đường dẫn kiểu Windows**: `/c/Temp/...` làm libSQL chết với `ConnectionFailed(...: 14)`. Dùng `C:/Temp/...` và `file:C:/Temp/.../cfl-feedback.db`.

### Việc tiếp theo

1. **Điền secret trên Dokploy** (`cfl-feedback-api` → Environment): `ADMIN_PASSWORD` và `LLM_VNG_LITE_API_KEY`. Đây là việc duy nhất đang chặn Deploy — domain `nip.io` là public internet, `ADMIN_PASSWORD` trống thì workspace mở cho bất kỳ ai có link.
2. **Deploy** cả 2 service, xem log build, verify `https://cfl-feedback-api.103.245.249.96.nip.io/api/health`.
3. **Đưa file libSQL 98MB lên volume `/data`** của container (`docker cp` vào volume `cfl-feedback-data`, hoặc upload rồi copy). Sau đó đặt `RUN_MIGRATIONS=false` cho lần khởi động đầu.
4. **Đổi 2 slot LLM sang `vng_lite`** qua UI `/api/llm-config` — chỉ sau khi đã chạy trên Dokploy.
5. Cắt domain, tắt Cloudflare.

⚠️ **Bẫy cutover vẫn nguyên**: đừng viết migration `UPDATE llm_agent_configs` sang `vng_lite` khi Cloudflare còn chạy production — edge Cloudflare không với tới gateway nội bộ VNG.

## Trạng thái tại 2026-09-04 cuối phiên 9 (làm tiếp) — CODE XONG 4/4, ĐANG CHUYỂN DỮ LIỆU

Phần sau của phiên 9: viết công cụ chuyển dữ liệu, kiểm chứng Dockerfile hết mức có thể mà không có Docker, và **bắt đầu xuất dữ liệu thật từ D1**.

### Xuất dữ liệu D1: đã chạy thật, xong 1/19 bảng, hết quota giữa lượt

Phát hiện đáng kể: **quota D1 chiều 04/09 vẫn còn** (query thử `SELECT 1` trả `rows_read: 0` bình thường) — nghĩa là fix chi phí đọc bậc hai (`b39d3d5`) đang có tác dụng, không còn cạn quota vì mở trang nữa. Nên đã xuất luôn thay vì chờ sáng.

Kết quả tới lúc hết quota:

| File | Nội dung |
|---|---|
| `C:\Temp\cfl-d1-dump-20260904 -schema.sql` | 9 KB — schema đầy đủ 20 bảng + `d1_migrations`, kèm `PRAGMA defer_foreign_keys=TRUE` |
| `C:\Temp\cfl-d1-dump-20260904-analyses.sql` | 36 MB — **85.567 dòng** `analyses` |

Rồi D1 trả `exceeded D1's free tier daily row read limit [code: 7500]`. **Không phải lỗi mới** — chỉ là bản thân việc xuất tốn quota, và phần quota còn lại của hôm nay đã dùng hết.

**Script tự resume**: bảng nào đã có file thì bỏ qua, nên chạy lại là tiếp tục từ bảng còn thiếu, không làm lại. Đã hẹn lịch tự chạy tiếp **07:06 GMT+7 ngày 05/09** (one-shot, ngay sau khi quota reset 00:00 UTC). ⚠️ Lịch này **chỉ sống trong phiên Claude hiện tại** — nếu phiên đã tắt thì tự chạy tay:

```powershell
cd "G:\CFM\Research\Crossfire Legends Sea\worker"
node scripts/d1-export.mjs C:\Temp\cfl-d1-dump-20260904
npm run build:import
node scripts/libsql-import.mjs C:\Temp\cfl-d1-dump-20260904 file:C:\Temp\cfl-feedback-libsql\cfl-feedback.db
```

### Luồng nhập dữ liệu đã diễn tập trọn vẹn, không cần D1: `npm run smoke:import` (10/10)

Dùng DB thật có dữ liệu thật: ingest CSV → dump ra đúng kiểu `wrangler d1 export` (schema + INSERT theo từng bảng) → nạp vào DB rỗng bằng chính `scripts/libsql-import.mjs` → boot app với `RUN_MIGRATIONS=false` → đọc lại qua API. Text có dấu `;`, dấu nháy `'` và tiếng Việt có dấu đều nguyên vẹn.

**Diễn tập này bắt được 2 lỗi thật** mà nếu không sẽ chỉ lòi ra lúc chạy trên dump 300MB thật (chi tiết ở `MEMORY.md` mục "Chuyen du lieu D1 -> libSQL"):
1. Dump theo từng bảng → thứ tự alphabet nạp `comments` **trước** `posts` → vỡ foreign key ngay dòng đầu.
2. Tắt enforcement rồi thì phải `PRAGMA foreign_key_check` **ở cuối cả lượt** — thiếu bước này thì một dump copy thiếu dòng vẫn "nạp thành công", mất dữ liệu âm thầm.

Ba bẫy khác gặp khi chạy thật, đã xử lý: `_cf_KV` (bảng nội bộ Cloudflare, trả `SQLITE_AUTH` **trùng code 7500** với lỗi hết quota — phân biệt bằng phần chữ, không phải code); `SELECT COUNT(*)` để ghi manifest chính là thứ đốt hết quota còn lại; `npx` trên Windows làm hỏng argument `--command`.

### Dockerfile: đã kiểm chứng hết mức không có Docker

Diễn lại từng bước của cả 2 stage bằng npm/node ở local: `npm ci` trên tree sạch → esbuild bundle → `npm prune --omit=dev` → chạy `dist/server.js` chỉ với node_modules production (**24 package, 24MB**). Boot được, migrate được, `/api/meta` + `/api/health` + `/api/processing/jobs` đều trả lời, lệnh HEALTHCHECK trong Dockerfile exit 0.

**Đã sửa 1 lỗi thật trong Dockerfile**: `USER node` không ghi được vào volume `/data` (named volume thuộc root) → container sẽ chết lúc boot với EACCES. Đã `mkdir /data && chown node:node /data` trong image.

Vẫn **chưa `docker build` thật** — máy này không có Docker. Đây là việc cần một máy có Docker.

### Việc tiếp theo (theo thứ tự)

1. **Xuất tiếp D1** — tự động 07:06 GMT+7 ngày 05/09, hoặc chạy tay bằng lệnh ở trên. Có thể mất vài ngày quota nếu 5 triệu dòng/ngày không đủ cho 18 bảng còn lại (`comments` 87.534 dòng và `processing_logs` là 2 bảng đắt nhất; `processing_logs` chỉ xuất 18.235 dòng có token nên rẻ).
2. **Build Docker thật** trên máy có Docker: `docker compose build && docker compose up`, rồi verify bằng `smoke:node`.
3. **Dựng service trên Dokploy**: gắn volume `/data`, khai biến môi trường theo `.env.example` (đã thêm ở root), tự nhập secret.
4. **Đổi 2 slot LLM sang `vng_lite`** qua UI `/api/llm-config` — chỉ sau khi đã chạy trên Dokploy, đọc bẫy dưới đây trước.
5. **Frontend + cắt domain**, rồi tắt Cloudflare.

### ⚠️ Bẫy cutover: đừng viết migration đổi slot sang `vng_lite` lúc này

Cloudflare vẫn đang chạy production, và **Cloudflare edge không gọi được gateway nội bộ VNG**. Một migration `UPDATE llm_agent_configs` sang `vng_lite` sẽ làm chết LLM của production ngay lần `d1 migrations apply` kế tiếp. Chỉ đổi **sau khi** đã cắt sang Dokploy, và đổi qua UI.

## Trạng thái tại 2026-09-04 giữa phiên 9 — CODE MIGRATION SANG DOKPLOY ĐÃ XONG 4/4

Bối cảnh không đổi và đừng bàn lại: **Dokploy VNG là hạ tầng bắt buộc**, container **không gọi được ra internet** nên LLM chỉ dùng được gateway nội bộ (`vng_lite`, model `gemini/gemini-3.5-flash-lite`). Số liệu tốc độ 6 model đã đo, đừng đo lại — xem `MEMORY.md`.

| | Việc | Trạng thái |
|---|---|---|
| 1 | Lớp adapter DB (`worker/src/db/libsqlAdapter.ts`) | ✅ xong (`446bb11`, phiên 8) |
| 2 | Entrypoint Node (`@hono/node-server`) + shim `waitUntil` | ✅ xong (`2cee0f7`) |
| 3 | 3 cron sang `node-cron` trong tiến trình | ✅ xong (`fabbf2c`) |
| 4 | Dockerfile + `docker-compose`, chạy thử trọn luồng ở local | ✅ xong (`3bd09fb`) |

Test **375/375 pass** (từ 336), `tsc --noEmit` sạch. Kiến trúc + biến môi trường + gotcha đã ghi vào `MEMORY.md` mục "Chay ngoai Cloudflare"; ở đây chỉ ghi tiến độ.

### Đã chạy thật trọn luồng ở local: 18/18 check

```powershell
cd worker
npm run build:node
npm run smoke:node
```

`worker/scripts/smoke-node.mjs` boot thẳng `dist/server.js` trên file libSQL thật rồi đi hết luồng qua HTTP: 19 migration áp lúc boot → 3 cron lên lịch UTC → `/api/health` → khóa admin từ chối ghi khi không có key → **upload CSV Facebook thật qua đường multipart** (2 dòng vào, dòng `Store` bị bỏ đúng như thiết kế) → đọc lại qua `/api/comments` đúng `source_type` → `/api/runs` → `/api/processing/jobs` (chính route sẽ vỡ nếu thiếu shim `executionCtx`) → `/api/ingest/status` → `/api/stats/overview` → `POST /api/processing/drain` → **restart trên cùng file DB**: 0 migration áp lại, dữ liệu còn nguyên.

Giữ script này. Nó là thứ trả lời được "app có chạy ngoài Workers không" bằng cách chạy thật, và sẽ là bài kiểm tra đầu tiên sau khi dựng container trên Dokploy.

### Hai thứ CHƯA kiểm chứng được ở phiên này (đừng báo là xong)

1. **Docker chưa từng build thật** — máy này không có Docker (`docker` không có trong PATH, không có service). `worker/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml` đã viết xong nhưng chưa ai `docker build` lần nào. Việc đầu tiên trên máy có Docker: `docker compose build && docker compose up`, rồi chạy lại `smoke:node` trỏ vào container.
2. **Đoạn gọi LLM chưa chạy** — không có key ở local, nên hàng đợi ghi log `"slot suy luận đang không có provider khả dụng"` và để comment nguyên trạng. Điều **đã** kiểm chứng là tiến trình KHÔNG chết vì việc đó (container phải sống khi gateway không với tới). Muốn thử thật: tự set `LLM_VNG_LITE_API_KEY` rồi trỏ cả 2 slot sang `vng_lite` qua `POST /api/llm-config` — đọc kỹ cái bẫy ngay dưới trước khi làm.

### ⚠️ Bẫy cutover: đừng viết migration đổi slot sang `vng_lite` lúc này

Cloudflare vẫn đang chạy production, và **Cloudflare edge không gọi được gateway nội bộ VNG**. Một migration `UPDATE llm_agent_configs` sang `vng_lite` sẽ làm chết LLM của production ngay lần `d1 migrations apply` kế tiếp. Chỉ đổi slot **sau khi** đã cắt sang Dokploy, và đổi qua UI `/api/llm-config` (hoặc migration chạy riêng bên đó).

### Việc tiếp theo (theo thứ tự)

1. **Build + chạy Docker** trên máy có Docker (xem mục "chưa kiểm chứng" #1).
2. **Frontend**: `VITE_API_BASE` được nướng vào bundle lúc build (`frontend/src/api/client.js`), nên URL API là **build arg**, không phải biến runtime — đổi URL là phải build lại image. `docker-compose.yml` đã truyền sẵn arg này.
3. **Xuất dữ liệu từ D1** (87.534 comment, ~310MB) — bắt buộc đọc D1 nên phải chờ quota reset **07:00 GMT+7** hằng ngày. Nhớ dọn trước 433.865 dòng `processing_logs` không mang token (giữ 18.235 dòng có token — nguồn duy nhất tính chi phí LLM). Khi nạp dump vào libSQL thì đặt `RUN_MIGRATIONS=false`: dump mang theo schema và cả các dòng `d1_migrations` của nó.
4. Dựng service trên Dokploy, đổi slot LLM sang `vng_lite`, verify bằng `smoke:node`.

### Trạng thái Cloudflare (vẫn đang chạy production)

Version đang chạy: **`e50a0bb1-52a7-4c62-a32e-6c5135eab5c1`**. Phiên 9 **không deploy gì lên Cloudflare** — mọi thay đổi đều là thêm đường vào thứ hai, `export default { fetch, scheduled }` trong `index.ts` còn nguyên. Nếu app trả HTTP 500: kiểm tra `/api/meta` còn sống (không đụng D1) + `/api/health` trả 500 = **hết quota D1**, không phải bug mới.

### Cảnh báo còn nguyên: J: lỗi git

`J:\My Drive\CFL\Agent\Tracking Store Social` vẫn `error: bad tree object HEAD`. Phiên 7, 8, 9 đều làm việc + commit từ **G:** (`G:\CFM\Research\Crossfire Legends Sea`). Coi G: là workspace chính cho tới khi J: được clone lại. Phiên 9 **chưa push** — 4 commit đang nằm ở local G:.

## Trạng thái tại 2026-09-04 cuối phiên 8 — ĐANG MIGRATE SANG DOKPLOY (1/4 việc code đã xong)

### Bối cảnh đã thay đổi hẳn: Dokploy là BẮT BUỘC, không phải lựa chọn

User xác nhận **Dokploy VNG là hạ tầng nội bộ bắt buộc dùng** — bỏ hẳn phương án ở lại Cloudflare (kể cả nâng plan trả phí). Mọi đề xuất kiểu "kiểm chứng thêm trên Cloudflare rồi tính" là **lạc đề**, đừng lặp lại: user đã phải nhắc về việc này.

### Phát hiện quyết định kiến trúc: container Dokploy KHÔNG gọi được ra ngoài

User đã xác nhận. Hệ quả: **2 provider LLM hiện tại sẽ chết khi migrate** (`openai_viax` qua `agent-shop.clawd.io.vn`, `gemini_viax` qua tunnel `rpi7jss.abc-tunnel.us`). Đường duy nhất dùng được là **gateway nội bộ `https://lite-aawp.vnggames.net/v1`** — đã thêm vào catalog dưới tên provider `vng_lite`, xem `MEMORY.md`.

Đã đo thật trên 1 batch 20 comment (2026-09-04), số liệu này là căn cứ chọn model, đừng đo lại:

| Model | Thời gian | Output token | Reasoning token |
|---|---|---|---|
| **`gemini/gemini-3.5-flash-lite`** ← đã chọn | **4,7s** | 1.821 | 0 |
| `gpt-5.4-mini` | 4,9s | 1.067 | 0 |
| `gemini-3.1-flash-lite-preview` | 5,0s | 1.777 | 0 |
| `gemini/gemini-3.6-flash` + `reasoning_effort=none` | 19,9s | 1.943 | 0 |
| `deepseek-v4-flash` + `reasoning_effort=low` | 28,2s | 3.200 | 1.628 |
| `deepseek-v4-flash` (mặc định) | 38,3s | 4.131 | 2.528 |

Tất cả đều trả JSON đúng 20/20. Hai điều đáng nhớ: `reasoning_effort` **chỉ có tác dụng với gemini** (68,8s → 19,9s), còn deepseek phớt lờ hoàn toàn giá trị `none`; và gateway **chuẩn OpenAI-compatible** nên dùng lại `OpenAIProvider` sẵn có, không cần viết provider mới.

### Việc code migration: 1/4 xong

| | Việc | Trạng thái |
|---|---|---|
| 1 | **Lớp adapter DB** (`worker/src/db/libsqlAdapter.ts`) | ✅ **XONG** (commit `446bb11`) |
| 2 | Entrypoint Node (`@hono/node-server`) + shim `waitUntil` | ⬜ chưa làm — **việc tiếp theo** |
| 3 | 3 cron sang `node-cron` trong tiến trình | ⬜ chưa làm |
| 4 | Dockerfile + `docker-compose`, chạy thử trọn luồng ở local | ⬜ chưa làm |

**Việc 1 đã trả lời xong câu hỏi lớn nhất của cả migration: 19/19 migration chạy sạch trên libSQL, không sửa một dòng SQL nào.** Không chỉ tin mock — có `worker/src/db/libsqlIntegration.test.ts` dựng libSQL in-memory thật, áp cả 19 migration, rồi gọi code thật (`loadQueueActivity`, `refreshRunCounts`, `loadTokenUsageByRange`, `DB.batch`). Partial index, `SUBSTR`, `GROUP BY`, batch insert trả `last_row_id` riêng từng dòng — tất cả đúng.

Hai chi tiết dễ vỡ mà integration test đã bắt được (đã xử lý, đừng vô tình phá lại):
- `lastInsertRowid` của libSQL là **BigInt** → phải `Number()`, vì 9 chỗ dùng trực tiếp làm id.
- `bind()` phải trả statement **mới** thay vì sửa tại chỗ, vì `services/` dùng lại statement trong vòng lặp.

Test hiện tại: **336/336 pass**, `tsc --noEmit` sạch.

### 🎯 Việc đầu tiên phiên sau: việc 2 (entrypoint Node)

Viết entrypoint cho Node dùng `@hono/node-server`: import lại đúng `app` (Hono instance) từ `index.ts`, bỏ phần `export default { fetch, scheduled }` kiểu Workers, thay bằng `serve({ fetch: app.fetch, port })`. Cần shim `executionCtx.waitUntil` vì Hono Node adapter không có sẵn — trên container chạy liên tục thì chỉ cần `{ waitUntil: (p) => { p.catch(e => console.error(e)) } }`.

Làm theo TDD, chạy `npx vitest run` + `npx tsc --noEmit` trước khi commit. **Không cần Dokploy hay D1 cho việc 2, 3, 4** — viết và test hoàn toàn ở local.

### Việc còn vướng D1 (chờ quota reset 07:00 GMT+7 hằng ngày)

**Xuất dữ liệu** từ D1 (87.534 comment, ~310MB) bắt buộc đọc D1 nên phải chờ. Đây là bước gần cuối, không cản việc 2/3/4. Khi làm, nhớ dọn trước 433.865 dòng `processing_logs` không mang token (giữ 18.235 dòng có token — xem MEMORY, đó là nguồn duy nhất tính chi phí LLM).

### Trạng thái Cloudflare hiện tại (vẫn đang chạy production)

Version đang chạy: **`e50a0bb1-52a7-4c62-a32e-6c5135eab5c1`**. Đã deploy fix chi phí đọc D1 bậc hai (`b39d3d5`) + provider `vng_lite` (`a1a0cf8`). **Chưa chuyển slot production sang `vng_lite`** — không cần thiết nữa vì đang rời Cloudflare; slot sẽ trỏ sang `vng_lite` khi dựng service trên Dokploy.

⚠️ Quota D1 đã cạn 2 ngày liên tiếp (03/09 và 04/09). Chưa đo được hiệu quả của fix bậc hai vì cạn quota trước khi kịp quan sát. Nếu sáng mai app lại 500 thì **kiểm tra đúng thứ tự này**: `/api/meta` còn sống (không đụng D1) + `/api/health` trả 500 = hết quota, không phải bug mới.

### Cảnh báo còn nguyên: J: lỗi git

`J:\My Drive\CFL\Agent\Tracking Store Social` vẫn trả `error: bad tree object HEAD`. **Toàn bộ phiên 7 và 8 làm việc + commit từ G:** (`G:\CFM\Research\Crossfire Legends Sea`). J: giờ lạc hậu nhiều commit. Coi **G: là workspace chính** cho tới khi J: được clone lại.

## ✅ Trạng thái tại 2026-09-04 07:03 GMT+7 (phiên 7, tiếp) — ĐÃ DEPLOY, production đã sống lại

Migration + deploy chạy tự động qua lịch hẹn (`CronCreate`, one-shot 07:03 GMT+7 ngay sau khi quota D1 reset lúc 00:00 UTC) — không cần người can thiệp.

- Migration: cả 3 migration mới (`0017`, `0018`, `0019`) áp dụng thành công ngay lần đầu — quota đã reset đúng giờ.
- Deploy: thành công. **Version ID `3530a5be-65f4-4fd6-9482-be277bd93d6a`**.
- Verify `/api/health`: `status: ok`, cả 2 slot LLM (`reasoning`/`openai_viax`, `simple`/`gemini_viax`) đều `ready: true`.
- Verify `/api/runs?limit=20` (chính endpoint gây lỗi hôm qua): trả về đúng dữ liệu. Lần gọi đầu 4.75s (phải đếm lại cả 20 run vì `counts_updated_at` còn NULL — lần đầu sau migration), lần gọi thứ 2 ngay sau đó nhanh hơn (~2s, không phải đếm lại) — xác nhận cơ chế cache trong `runCounters.ts` hoạt động đúng như thiết kế.

**Việc còn lại**: theo dõi vài ngày xem D1 row-read/ngày có ổn định ở mức thấp không (trước đây ~1 triệu dòng/lần mở trang Ingest, giờ kỳ vọng vài trăm dòng). Không có lệnh đo trực tiếp usage/ngày qua CLI — nếu cần, kiểm tra qua Cloudflare Dashboard → Workers & Pages → D1 → Metrics.

## 🔴 CẬP NHẬT 2026-09-04 ~09:50 — quota HẾT LẠI sau vài tiếng, đã tìm ra nguyên nhân thứ 2

Sau khi deploy sáng nay, quota D1 lại cạn chỉ sau vài giờ. Fix hôm qua đúng nhưng **chưa đủ** — nó chỉ cắt chi phí *mở trang*, còn thủ phạm lớn hơn nằm ở **chính hàng đợi xử lý**, và fix `await` hôm qua vô tình làm nó lộ ra: trước đây job bị giết sau 30s nên quét được ít, giờ chạy thật nên quét liên tục.

**Chi phí bậc hai trong `pendingComments`/`pendingTranslations`**: mỗi lượt xử lý chỉ làm `maxBatches × batchSize` = 100 comment, nhưng câu SELECT lại **tải toàn bộ** comment còn lại của run rồi vứt phần thừa. Hoàn thành 1 run N comment tốn ~N²/100 dòng đọc → riêng run #133 (16.429 comment) ≈ **2,7 triệu dòng đọc**.

Đã sửa (commit `b39d3d5`, deploy version `295a09b2-6cff-40b6-9bcb-fce6b8bc26ab`):
- Đẩy `LIMIT` xuống SQL cho cả 2 hàm — chỉ đọc đúng số dòng một lượt xử lý được.
- Mẫu số thanh tiến độ lấy từ `COUNT` riêng, chỉ chạy **1 lần cho mỗi job** (khi chạm trần và chưa có total cũ) thay vì mỗi lượt → từ ~N²/100 xuống ~2N.
- Sweep cưỡng bức (`force`, không truyền `maxBatches`) vẫn không giới hạn, vì nó có chủ đích quét lại toàn bộ.

Test 318/318 pass, typecheck sạch, đã deploy.

⚠️ **Chưa verify được** vì quota đang cạn tới 00:00 UTC (07:00 GMT+7 ngày 05/09). Khi quota reset, việc đầu tiên là **đo thật** xem read/ngày có còn tăng bất thường không (Cloudflare Dashboard → D1 → Metrics), đừng mặc định là đã xong — đây là lần thứ 2 tưởng xong mà chưa xong.

**Bài học chung**: mọi vòng lặp xử lý theo lô phải giới hạn ngay trong SQL, không được "tải hết rồi cắt trong bộ nhớ". Chi phí tính theo số dòng **quét**, không phải số dòng dùng.

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
