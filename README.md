# CFL Feedback Intelligence

Ứng dụng nội bộ để đội vận hành game **Crossfire Legends (CFL)** theo dõi, phân loại và tổng hợp feedback người chơi từ nhiều nguồn: đánh giá Store, bình luận Facebook Fanpage, và bình luận Facebook Group (upload thủ công). Hệ thống tự động kéo dữ liệu, khử trùng lặp, phân loại chủ đề/cảm xúc bằng LLM, dịch sang tiếng Trung (zh-CN), lưu vào database và hiển thị trên dashboard web.

## Mục lục

- [Kiến trúc](#kiến-trúc)
- [Nguồn dữ liệu](#nguồn-dữ-liệu)
- [Luồng xử lý](#luồng-xử-lý)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Chạy local](#chạy-local)
- [Biến môi trường & secrets](#biến-môi-trường--secrets)
- [Database & migrations](#database--migrations)
- [LLM provider](#llm-provider)
- [Khóa quản trị (admin lock)](#khóa-quản-trị-admin-lock)
- [Test](#test)
- [Deploy](#deploy)
- [Taxonomy phân loại](#taxonomy-phân-loại)
- [Giới hạn kỹ thuật cần biết](#giới-hạn-kỹ-thuật-cần-biết)

## Kiến trúc

> **Cập nhật 2026-09-14 — production đã chuyển sang Dokploy nội bộ VNG.**
> Ứng dụng chạy bằng **Node + Docker** trên Dokploy, database là **libSQL** (file SQLite
> trên volume), LLM dùng **gateway nội bộ VNG**. Bản Cloudflare (Worker + D1 + Pages) vẫn
> còn chạy song song nhưng không còn là production. Cùng một codebase chạy được cả hai:
> `worker/src/index.ts` vẫn export handler kiểu Workers, còn `worker/src/node/` là
> entrypoint Node. Sơ đồ dưới mô tả bản Cloudflare — thay "Cloudflare Worker" bằng
> "container Node trên Dokploy" và "D1" bằng "libSQL" là ra kiến trúc hiện tại.
>
> | | Production hiện tại (Dokploy) | Bản cũ (Cloudflare) |
> |---|---|---|
> | Backend | container Node, `worker/Dockerfile` | Cloudflare Worker |
> | Database | libSQL, file trên volume `/data` | Cloudflare D1 |
> | Frontend | nginx tĩnh, `frontend/Dockerfile` | Cloudflare Pages |
> | Cron | `node-cron` trong tiến trình (UTC) | Cron Triggers |
> | LLM | gateway nội bộ VNG (`vng_lite`) | proxy Viax |
>
> Chi tiết vận hành (địa chỉ, tên service, biến môi trường, các bẫy đã gặp) nằm ở
> `MEMORY.md` mục "Dokploy production". Lộ trình migrate xem `MIGRATION.md`.

Sơ đồ bản Cloudflare:

```
┌─────────────────┐      ┌──────────────────────┐      ┌────────────────┐
│  Sensor Tower    │      │  Facebook Graph API   │      │  CSV upload     │
│  (Store VN)      │      │  (Fanpage)            │      │  (Group)        │
└────────┬─────────┘      └──────────┬───────────┘      └────────┬────────┘
         │                            │                            │
         └────────────────┬───────────┴────────────────────────────┘
                           ▼
                ┌─────────────────────────┐
                │  Cloudflare Worker       │   worker/  (Hono + TypeScript)
                │  - Ingest + dedupe       │
                │  - Hàng đợi xử lý nền    │
                │  - Phân loại bằng LLM    │
                │  - Dịch zh-CN            │
                │  - REST API              │
                └────────────┬─────────────┘
                             │
                   ┌─────────┴──────────┐
                   ▼                    ▼
          ┌────────────────┐   ┌──────────────────┐
          │  Cloudflare D1  │   │  LLM providers    │
          │  (SQLite)       │   │  (xem mục riêng)  │
          └────────────────┘   └──────────────────┘
                             ▲
                             │ REST API
                ┌─────────────────────────┐
                │  Cloudflare Pages        │   frontend/  (React + Vite)
                │  Feedback Workspace,     │
                │  Ingest & Cài đặt        │
                └─────────────────────────┘
```

- **`worker/`** — backend production. Cloudflare Worker viết bằng TypeScript, dùng framework [Hono](https://hono.dev/), lưu dữ liệu vào **Cloudflare D1** (SQLite chạy trên edge). Xử lý ingest, hàng đợi phân loại/dịch chạy nền, và toàn bộ REST API cho frontend.
- **`frontend/`** — dashboard, React 19 + Vite, deploy lên **Cloudflare Pages**. Gồm 2 trang chính: **Feedback Workspace** (đọc/lọc/insight comment) và **Ingest & Cài đặt** (nạp dữ liệu, cấu hình LLM, xem token đã dùng).
- **`backend/`** — bản FastAPI + SQLAlchemy + APScheduler **cũ, không còn là backend production**. Giữ lại làm phương án tự host thay thế nếu cần rời khỏi Cloudflare (xem thêm mục Deploy). Không được cập nhật song song với `worker/` — logic mới nhất chỉ có ở `worker/`.
- **`track_*.py`, `generate_html_report.py`** — script Python gốc từ trước khi có web app, kéo dữ liệu và xuất báo cáo HTML thủ công. Vẫn giữ ở root, độc lập với `worker/`/`frontend/`.
- **`Demo Report/`** — 2 file HTML báo cáo mẫu, xuất thủ công bằng script Python trên, không liên quan tới web app.
- **`docs/`** — ghi chú thiết kế cho các nâng cấp lớn (vd nâng cấp model LLM).

## Nguồn dữ liệu

| Nguồn | Cách lấy | Ghi chú |
|---|---|---|
| Store (Google Play `gp` + App Store `ios`, VN) | Sensor Tower API | Cron hằng ngày kéo theo cursor tăng dần, chỉ kéo tới hôm qua (GMT+7) |
| Facebook Fanpage | Facebook Graph API | Cron hằng ngày kéo bài viết + bình luận theo cursor |
| Facebook Group | Upload CSV thủ công | Giới hạn 60.000 dòng/lần nạp; khử trùng lặp theo `dedupe_hash` nên nạp trùng vẫn an toàn |

## Luồng xử lý

Sau mỗi lần ingest thành công (cron hoặc thủ công), Worker tự động xếp vào hàng đợi theo thứ tự:

1. **Phân loại (classify)** — LLM gán chủ đề lớn (taxonomy cố định), chủ đề con (phát hiện động), cảm xúc, mức độ khẩn cấp cho từng comment.
2. **Ghi nhớ taxonomy** — chủ đề con mới phát hiện được lưu vào bộ nhớ taxonomy để lần sau nhận diện nhất quán hơn.
3. **Dịch zh-CN** — dịch nội dung comment gốc + phần tóm tắt sang tiếng Trung giản thể.

Toàn bộ chạy nền qua `processing_queue` trong D1 (không giữ state trong memory), có cron quét mỗi 5 phút để tự phục hồi job bị treo/lỗi — không phụ thuộc việc có ai mở trình duyệt hay không. Nút "Phân tích lại"/"Dịch lại" trên UI chỉ dùng để chạy lại thủ công khi cần.

## Cấu trúc thư mục

```
worker/
  src/
    index.ts              # entry point, mount routes, cron dispatcher
    types.ts               # Env (bindings + secrets)
    taxonomy.ts             # chủ đề lớn, nhãn cảm xúc, urgency, prompt version
    routes/                 # 1 file / nhóm endpoint (ingest, comments, runs, stats, insights,
                             #   analyze, translate, processing, llm-config, admin, export, report...)
    services/                # logic nghiệp vụ: ingest từng nguồn, LLM adapter, hàng đợi xử lý,
                             #   taxonomy memory, token usage, admin auth...
  migrations/                # D1 schema migrations, đánh số tuần tự

frontend/
  src/
    pages/
      FeedbackWorkspace.jsx  # trang chính: đọc/lọc comment, topic ranking, insight/summarize
      IngestSettings.jsx     # nạp dữ liệu, cấu hình LLM, lịch sử ingest, token đã dùng
    api/client.js             # toàn bộ lời gọi REST API
    utils/                    # BYO LLM session, admin session, format ngày, parse CSV Facebook

backend/                      # FastAPI legacy, không phải production hiện tại
handoff/HANDOFF.md            # bàn giao tiến độ giữa các phiên làm việc
AGENT.md                      # quy tắc làm việc cho agent AI tiếp tục dự án này
MEMORY.md                     # kiến trúc/config/secret/gotcha kỹ thuật, cập nhật liên tục
```

## Chạy local

Yêu cầu: Node.js. Không cần tài khoản Cloudflare nếu chỉ chạy bản Node.

**Cách khuyến nghị — chạy đúng bản đang ở production (Node + libSQL):**

```bash
cd worker
npm ci
npm run build:node                     # esbuild bundle -> dist/server.js
LIBSQL_URL=file:./data/cfl.db npm run start:node
```

Chạy trọn luồng để kiểm chứng (tự tạo DB tạm, ingest CSV thật, đọc lại qua API, restart):

```bash
cd worker
npm run build:node && npm run smoke:node     # 18 check
npm run smoke:import                         # 10 check, diễn tập nạp dump
```

Biến môi trường phía Node: `LIBSQL_URL` (**bắt buộc**, không có mặc định), `PORT` (8787), `CRON_ENABLED` (mặc định `true`), `RUN_MIGRATIONS` (mặc định `true`), `MIGRATIONS_DIR`.

**Bản Cloudflare (cũ):**

```bash
cd worker
npm install
npm run dev            # wrangler dev, mặc định port 8787
```

```bash
cd frontend
npm install
npm run dev            # vite dev server
```

Frontend đọc biến `VITE_API_BASE` (xem `.env.development`) để biết địa chỉ API — mặc định trỏ `http://localhost:8787` khi chạy `worker dev` local.

> Lưu ý: local dev hiện chưa chạy được `wrangler dev` trên bản Worker mới nhất do một lỗi export không tương thích với `wrangler` 4.107 (`Incorrect type for map entry 'DAILY_INGEST_CRON'`) — không ảnh hưởng `wrangler deploy`/production, chỉ ảnh hưởng máy chủ dev cục bộ. Xem `handoff/HANDOFF.md` mục việc tồn đọng.

## Biến môi trường & secrets

Không có secret nào được commit vào repo. Trên Dokploy đặt ở tab **Environment** của service; trên Cloudflare đặt bằng `wrangler secret put <TÊN>`.

| Tên | Mục đích |
|---|---|
| `ADMIN_PASSWORD` | Mật khẩu chung mở khóa phần ghi của tab Ingest & Cài đặt. Chưa set = workspace mở cho mọi người có link. |
| `LLM_VNG_LITE_API_KEY` | Key gateway LLM nội bộ VNG — **bắt buộc**, không có nó thì không slot nào gọi được. |
| `SENSORTOWER_API_KEY` | Key gọi Sensor Tower API. |
| `FB_PAGE_ID` | ID Fanpage Facebook cần theo dõi. |
| `FB_ACCESS_TOKEN` | Page Access Token của Fanpage trên. |

Các biến không nhạy cảm (batch size, endpoint base URL gateway, lịch cron) nằm trong `worker/wrangler.jsonc` mục `vars` cho bản Cloudflare, và trong `NODE_VAR_DEFAULTS` (`worker/src/node/nodeEnv.ts`) cho bản Node — có test đọc thẳng `wrangler.jsonc` so từng giá trị để 2 runtime không âm thầm lệch nhau. Mẫu đầy đủ cho Docker/Dokploy: `.env.example` ở root.

Backend FastAPI legacy dùng file `.env` riêng (xem `.env.example` ở root) — không dùng ở production hiện tại.

## Database & migrations

Migration nằm ở `worker/migrations/`, đánh số tuần tự (hiện tại tới `0020`). **Cùng một bộ file SQL chạy được cả trên D1 lẫn libSQL** — không phải sửa dòng nào khi migrate, đó là lý do chọn libSQL thay vì Postgres.

Bản Node (production hiện tại): migration **tự chạy lúc khởi động**, trước request đầu tiên, và idempotent nên restart không tốn gì. Theo dõi bằng bảng `d1_migrations` — cố ý đặt trùng tên với wrangler để dump xuất từ D1 khôi phục vào là tự biết migration nào đã áp. Tắt bằng `RUN_MIGRATIONS=false` (dùng khi đang khôi phục dump mang sẵn schema).

Bản Cloudflare:

```bash
cd worker
npx wrangler d1 migrations apply cfl-feedback --local    # môi trường dev local
npx wrangler d1 migrations apply cfl-feedback --remote   # production
```

Chuyển dữ liệu giữa 2 bên bằng `worker/scripts/d1-export.mjs` (xuất từ D1, resume được) và `worker/scripts/libsql-import.mjs` (nạp vào libSQL, kiểm tra khóa ngoại sau khi nạp xong).

Các bảng chính: `comments` (dữ liệu gốc + dedupe hash), `posts` (bài viết Facebook), `analyses` + `analysis_corrections` (kết quả phân loại LLM và chỉnh sửa thủ công), `comment_translations` (bản dịch zh-CN), `ingest_runs` + `ingest_cursors`, `processing_queue` + `processing_logs` (hàng đợi xử lý nền), `llm_agent_configs` + `llm_slot_state` + `llm_provider_secrets` (cấu hình/trạng thái leo thang LLM), `taxonomy_subtopics` + `feedback_memories` + `memory_evidence` (bộ nhớ chủ đề con), `saved_insights`, `app_settings`.

## LLM provider

Từ 2026-09-14, catalog (`worker/src/services/llmCatalog.ts`) chỉ còn **1 provider**: `vng_lite` — gateway nội bộ VNG (`https://lite-aawp.vnggames.net/v1`, chuẩn OpenAI-compatible). Endpoint và key giữ phía server (biến môi trường), người dùng không phải nhập gì.

Đã bỏ 2 proxy "by Viax" và 3 endpoint "chính chủ" + `custom`: mạng nội bộ không gọi ra được domain nào trong số đó, để lại chỉ là bẫy cấu hình một slot chắc chắn thất bại mọi lần gọi. Bring-your-own-key tắt theo (không còn provider nào `byo: true`).

Hệ thống chia công việc LLM thành 2 "slot":

| Slot | Dùng cho | Model | Tốc độ đo thật (batch 20 comment) |
|---|---|---|---|
| `reasoning` | phân tích/phân loại comment, report, insight, taxonomy | `gemini/gemini-3.6-flash` | 9,3–9,8s |
| `simple` | dịch zh-CN | `gemini/gemini-3.5-flash-lite` | 4,3–4,5s |

Code gửi `reasoning_effort: "none"` cho model có chữ `gemini` trong tên — đo thật cho thấy 3.6-flash mất 68,8s nếu không có tham số này và 19,9s khi có. Không gửi cho model khác (deepseek phớt lờ nó, và tham số lạ là lỗi 400 với một số gateway).

Mỗi slot có cơ chế leo thang: lỗi liên tiếp 3 lần → chuyển sang tầng phụ → lỗi thêm 3 lần → dừng gọi LLM cho tới khi cron reset (14:00 GMT+7 hằng ngày). Vì chỉ còn 1 gateway và 1 model mỗi slot, **tầng phụ trùng luôn tầng chính** — leo thang giờ là ngân sách 6 lần thử chứ không còn đổi provider. Không có fallback bằng rule/từ khóa: comment lỗi giữ nguyên trạng thái chưa xử lý chờ retry.

**Đổi model thì phải làm 2 việc, không chỉ 1**: sửa catalog trong code **và** thêm migration `UPDATE llm_agent_configs` — bảng đã có dòng seed từ migration `0012` và code ưu tiên dòng trong DB (tiền lệ `0013`, `0016`, `0020`). Và luôn hỏi `GET /v1/models` trước để lấy đúng tên model gateway thật sự phục vụ, đừng đoán theo tên thương mại.

## Khóa quản trị (admin lock)

Tab **Ingest & Cài đặt** có khóa mật khẩu chung (`ADMIN_PASSWORD`) cho mọi thao tác ghi (nạp dữ liệu, phân tích/dịch lại, đổi provider LLM, xóa run). Ai có link vẫn xem được toàn bộ trạng thái/lịch sử — chỉ người có mật khẩu mới thao tác được. Biên giới thật nằm ở Worker (middleware `requireAdmin`), không phải chỉ ẩn nút ở giao diện. Chi tiết đầy đủ ở `MEMORY.md` mục "Khoa quan tri".

## Test

```bash
cd worker
npm test          # vitest
npm run typecheck  # tsc --noEmit
```

```bash
cd frontend
node --test "src/**/*.test.js"   # không có script npm test riêng
npm run lint                      # oxlint
npm run build                     # vite build
```

> Ghi chú vận hành: nếu checkout nằm trên ổ đồng bộ cloud (Google Drive, OneDrive...), một số lệnh trên có thể chạy chậm/treo do I/O nhiều file nhỏ qua mạng. Nên chạy từ một ổ đĩa local thật.

## Deploy

### Dokploy (production hiện tại)

Hai service trong project `CFL / production` trên `https://host.vnggames.ai`:

| Service | Build | Domain |
|---|---|---|
| `cfl-feedback-api` | `worker/Dockerfile`, context `worker` | `cfl-feedback-api.103.245.249.96.nip.io` (port 8787) |
| `cfl-feedback-web` | `frontend/Dockerfile`, context `frontend` | `cfl-feedback.103.245.249.96.nip.io` (port 80) |

Quy trình: push lên `main` → vào Dokploy bấm **Deploy** → chờ build xong → **Stop rồi Start**.

Hai điều bắt buộc phải biết, cả hai đều đã cắn một lần:

- **Autodeploy bật nhưng webhook không bắn.** Push không kích hoạt gì, luôn phải bấm Deploy tay.
- **Container không tự nhận image mới sau khi build xong**, và **Reload cũng không đủ** — phải Stop → Start (gián đoạn ~15 giây). Deploy báo "Done" chỉ nghĩa là image đã build.

Kiểm tra sau deploy — **không dừng ở `/api/health`**, vì `ready: true` chỉ nghĩa là "có credential", không phải "gọi được LLM và parse được kết quả":

```bash
curl https://cfl-feedback-api.103.245.249.96.nip.io/api/health
curl https://cfl-feedback-api.103.245.249.96.nip.io/api/stats/overview
# và quan trọng nhất: phải thấy batch level=success thật
curl "https://cfl-feedback-api.103.245.249.96.nip.io/api/processing/jobs/<id>/logs?limit=5"
```

### Cloudflare (bản cũ, còn chạy song song)

```bash
cd worker
npx wrangler deploy
```

```bash
cd frontend
npm run build
npx wrangler pages deploy ./dist --project-name=cfl-feedback --branch main
```

## Taxonomy phân loại

Chủ đề lớn (topic) là danh sách cố định trong `worker/src/taxonomy.ts`, gồm các nhóm như hiệu năng/kỹ thuật (lag/FPS, crash, mạng), tài khoản/thanh toán, gameplay (chế độ chơi, bắn súng, ghép trận, rank, cân bằng), kinh tế trong game (gacha, vật phẩm, phần thưởng), cộng đồng (chat, hành vi, hack/cheat), vận hành (sự kiện, cập nhật, CSKH), và một nhóm dùng để so sánh với các phiên bản/khu vực khác của game.

Chủ đề con (subtopic) được LLM phát hiện động sau mỗi lần chạy, có cơ chế gom các cách diễn đạt cùng nghĩa lại với nhau thay vì tạo nhiều chủ đề con trùng lặp theo câu chữ.

## Giới hạn kỹ thuật cần biết

- Cloudflare D1 giới hạn số bound parameter/statement thấp — query `IN (...)` phải chunk (~90 item/lần). Ràng buộc này giữ nguyên trong code dù libSQL không có giới hạn đó, vì code vẫn chạy chung cho cả 2 runtime.
- Cloudflare Workers giới hạn số subrequest/invocation — việc kéo Facebook/Sensor Tower phải giới hạn page/range hợp lý. Trên container Node không còn giới hạn này, nhưng chưa nới vì chưa cần.
- **Mọi vòng lặp xử lý theo lô phải giới hạn ngay trong SQL**, không "tải hết rồi cắt trong bộ nhớ" — chi phí đọc tính theo số dòng *quét*. Lần vi phạm gần nhất tốn ~N²/100 dòng đọc cho một run N comment và làm sập production một ngày.
- **LLM có thể trả `id` kiểu string** (`"id": "255087"`). Parser đã ép kiểu, nhưng đây là loại lỗi rơi sạch 100% kết quả mà không báo gì — khi đổi model phải kiểm tra `processing_logs` có batch `success` thật.
- Giới hạn nạp CSV: 60.000 dòng/lần, vượt quá sẽ hết bộ nhớ (128MB) khi decode file trước khi kịp chạm giới hạn subrequest.
- Dependency `xlsx` phải cài từ `cdn.sheetjs.com`, không dùng bản trên npm registry (có lỗ hổng bảo mật chưa vá).

Chi tiết đầy đủ hơn (bug đã gặp, quyết định kiến trúc, trạng thái vận hành mới nhất) nằm ở `MEMORY.md` và `handoff/HANDOFF.md` — 2 file này được cập nhật liên tục theo từng phiên làm việc, còn README này chỉ mô tả bức tranh tổng quan ổn định của dự án.
