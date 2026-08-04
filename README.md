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

Hệ thống production hiện tại chạy hoàn toàn trên **Cloudflare**:

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

Yêu cầu: Node.js, tài khoản Cloudflare đã đăng nhập `wrangler` (`npx wrangler login`).

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

Không có secret nào được commit vào repo. Danh sách **tên** biến cần cấu hình trên Cloudflare Worker (giá trị thật đặt bằng `wrangler secret put <TÊN>`, không đặt trong file):

| Tên | Mục đích |
|---|---|
| `ADMIN_PASSWORD` | Mật khẩu chung mở khóa phần ghi của tab Ingest & Cài đặt. Chưa set = workspace mở cho mọi người có link. |
| `LLM_VIAX_API_KEY` | Key cho proxy LLM nội bộ ("by Viax"). |
| `SENSORTOWER_API_KEY` | Key gọi Sensor Tower API. |
| `FB_PAGE_ID` | ID Fanpage Facebook cần theo dõi. |
| `FB_ACCESS_TOKEN` | Page Access Token của Fanpage trên. |

Các biến không nhạy cảm (batch size, endpoint base URL của proxy LLM, lịch cron) nằm trong `worker/wrangler.jsonc` mục `vars`.

Backend FastAPI legacy dùng file `.env` riêng (xem `.env.example` ở root) — không dùng ở production hiện tại.

## Database & migrations

Cloudflare D1 (SQLite), tên database `cfl-feedback`. Migration nằm ở `worker/migrations/`, đánh số tuần tự (hiện tại tới `0015`). Áp dụng bằng:

```bash
cd worker
npx wrangler d1 migrations apply cfl-feedback --local    # môi trường dev local
npx wrangler d1 migrations apply cfl-feedback --remote   # production
```

Các bảng chính: `comments` (dữ liệu gốc + dedupe hash), `posts` (bài viết Facebook), `analyses` + `analysis_corrections` (kết quả phân loại LLM và chỉnh sửa thủ công), `comment_translations` (bản dịch zh-CN), `ingest_runs` + `ingest_cursors`, `processing_queue` + `processing_logs` (hàng đợi xử lý nền), `llm_agent_configs` + `llm_slot_state` + `llm_provider_secrets` (cấu hình/trạng thái leo thang LLM), `taxonomy_subtopics` + `feedback_memories` + `memory_evidence` (bộ nhớ chủ đề con), `saved_insights`, `app_settings`.

## LLM provider

Có 1 catalog cố định 6 provider (`worker/src/services/llmCatalog.ts`), chia làm 2 nhóm:

- **"by Viax"** (`gemini_viax`, `openai_viax`) — endpoint/key giữ phía server, người dùng chỉ chọn qua UI, không cần tự nhập key.
- **Bring-your-own-key** (`anthropic_direct`, `gemini_direct`, `openai_direct`, `custom`) — người dùng tự nhập API key + (với `custom`) endpoint riêng, chỉ áp dụng cho tab trình duyệt đang mở (giữ trong `sessionStorage`, gửi qua header, không lưu server).

Hệ thống chia công việc LLM thành 2 "slot":

- `reasoning` — phân tích/phân loại comment, sinh report, insight.
- `simple` — dịch zh-CN.

Mỗi slot có cơ chế leo thang tự động: dùng provider chính → lỗi liên tiếp 3 lần → chuyển sang provider phụ → lỗi thêm 3 lần → dừng gọi LLM cho tới khi cron reset (14:00 GMT+7 hằng ngày). Không còn fallback bằng rule/từ khóa như phiên bản cũ — comment lỗi sẽ giữ nguyên trạng thái chưa xử lý chờ retry.

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

```bash
cd worker
npx wrangler deploy
```

```bash
cd frontend
npm run build
npx wrangler pages deploy ./dist --project-name=cfl-feedback --branch main
```

Sau deploy, kiểm tra nhanh:

```bash
curl https://<worker-domain>/api/health
curl https://<worker-domain>/api/admin/status
```

## Taxonomy phân loại

Chủ đề lớn (topic) là danh sách cố định trong `worker/src/taxonomy.ts`, gồm các nhóm như hiệu năng/kỹ thuật (lag/FPS, crash, mạng), tài khoản/thanh toán, gameplay (chế độ chơi, bắn súng, ghép trận, rank, cân bằng), kinh tế trong game (gacha, vật phẩm, phần thưởng), cộng đồng (chat, hành vi, hack/cheat), vận hành (sự kiện, cập nhật, CSKH), và một nhóm dùng để so sánh với các phiên bản/khu vực khác của game.

Chủ đề con (subtopic) được LLM phát hiện động sau mỗi lần chạy, có cơ chế gom các cách diễn đạt cùng nghĩa lại với nhau thay vì tạo nhiều chủ đề con trùng lặp theo câu chữ.

## Giới hạn kỹ thuật cần biết

- Cloudflare D1 giới hạn số bound parameter/statement thấp — query `IN (...)` phải chunk (~90 item/lần).
- Cloudflare Workers giới hạn số subrequest/invocation — việc kéo Facebook/Sensor Tower phải giới hạn page/range hợp lý.
- Giới hạn nạp CSV: 60.000 dòng/lần, vượt quá sẽ hết bộ nhớ (128MB) khi decode file trước khi kịp chạm giới hạn subrequest.
- Dependency `xlsx` phải cài từ `cdn.sheetjs.com`, không dùng bản trên npm registry (có lỗ hổng bảo mật chưa vá).

Chi tiết đầy đủ hơn (bug đã gặp, quyết định kiến trúc, trạng thái vận hành mới nhất) nằm ở `MEMORY.md` và `handoff/HANDOFF.md` — 2 file này được cập nhật liên tục theo từng phiên làm việc, còn README này chỉ mô tả bức tranh tổng quan ổn định của dự án.
