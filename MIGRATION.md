# Hướng dẫn migrate CFL Feedback Intelligence rời khỏi Cloudflare

Tài liệu này viết cho đội/dev **bên ngoài** nhận migrate hệ thống này sang hạ tầng tự quản lý (ví dụ **Dokploy** trên VPS riêng, hoặc bất kỳ Docker/Node hosting nào khác). Đọc `README.md` trước để hiểu tổng quan sản phẩm; tài liệu này chỉ tập trung vào **cái gì phải đổi khi rời Cloudflare** và cách đổi.

> Đây là bản hướng dẫn kỹ thuật dựa trên phân tích code thật (đã verify từng điểm bên dưới bằng cách đọc source), **không phải một migration đã chạy thử thành công trên Dokploy** — đội nhận việc cần tự dựng và test lại từng bước.

## Vì sao không "docker run" là xong

Backend hiện tại (`worker/`) không phải Node.js app thông thường — nó là **Cloudflare Worker**, chạy trên V8 isolate runtime riêng của Cloudflare, dùng 2 API chỉ tồn tại trên nền tảng đó:

1. **D1** (`env.DB`) — SQLite chạy qua binding của Cloudflare, không phải file SQLite hay client TCP thông thường.
2. **`ExecutionContext.waitUntil`** (`c.executionCtx.waitUntil(...)`) — cho phép tiếp tục chạy code nền sau khi đã trả response, đặc thù runtime Workers.

Ngoài 2 điểm này, code **không** dùng thêm binding Cloudflare nào khác (đã kiểm tra: không có KV, R2, Queues, Durable Objects, `caches.*`, hay global đặc thù nào khác trong `worker/src/types.ts`/`index.ts`). Phạm vi cần đổi thu hẹp lại đúng 2 chỗ này cộng với cron và secrets.

## Bảng ánh xạ: Cloudflare → hạ tầng tự quản lý (ví dụ Dokploy)

| Thành phần Cloudflare | Dùng ở đâu trong code | Thay bằng gì trên Dokploy/self-host |
|---|---|---|
| **Worker runtime** (`export default { fetch, scheduled }`) | `worker/src/index.ts` | Hono có adapter Node chính thức [`@hono/node-server`](https://github.com/honojs/node-server) — hầu hết route/service (`routes/`, `services/`) là TypeScript thuần, không đổi. Chỉ cần viết lại phần entrypoint bootstrap server. |
| **D1** (`env.DB.prepare(sql).bind(...).all()/.run()/.first()`) | Toàn bộ `services/*.ts` (đọc/ghi DB) | 2 lựa chọn: **(a)** giữ SQLite, dùng [`@libsql/client`](https://github.com/tursodatabase/libsql-client-ts) hoặc `better-sqlite3` — API `.prepare().bind()` gần giống nên viết 1 lớp adapter mỏng bọc lại, không cần sửa từng câu query. **(b)** đổi sang Postgres nếu hạ tầng chuẩn hóa Postgres — cần: viết lại migration (SQLite → Postgres dialect: `AUTOINCREMENT`→`SERIAL/IDENTITY`, kiểu ngày ISO8601 TEXT có thể giữ nguyên dạng TEXT hoặc đổi `TIMESTAMPTZ`) và thay lớp adapter bằng `pg`/Prisma/Drizzle. **(a) rủi ro thấp hơn nhiều** vì schema hiện tại là SQLite chuẩn, không dùng cú pháp riêng của D1. |
| **`ExecutionContext.waitUntil`** | `index.ts` (cron handler), `routes/analyze.ts`, `routes/ingest.ts`, `routes/translate.ts`, `services/processingQueue.ts` | Trên Node process chạy liên tục (Docker container luôn sống, không bị teardown sau mỗi request như Workers), chỉ cần **không `await`** promise đó trước khi trả response — pattern hiện tại `promise.catch(e => console.error(...))` đã đúng ý, chỉ cần viết 1 shim nhỏ để `c.executionCtx.waitUntil` không throw trên Node (Hono Node adapter không có `executionCtx` mặc định — tự implement `{ waitUntil: (p) => { p.catch(...) } }` và gắn vào context). |
| **Cron Triggers** (`wrangler.jsonc` → `triggers.crons`, dispatch trong `scheduled()`) | `index.ts` — 3 lịch: `45 6 * * *`, `0 7 * * *`, `*/5 * * * *` (UTC) | Dokploy có tính năng **Schedules** (chạy lệnh/gọi endpoint theo cron) — trỏ vào 1 endpoint nội bộ (vd `POST /internal/cron/daily-ingest`) mà code gọi lại đúng hàm `dailyJob`/`dailySlotResetJob`/`sweepProcessingQueue` hiện có. Hoặc dùng `node-cron` chạy ngay trong process Node. Nhớ giữ đúng giờ UTC hoặc quy đổi cẩn thận (list gốc đã quy đổi GMT+7 trong comment code). |
| **Cloudflare Pages** (frontend) | `frontend/` build ra `dist/` | Bất kỳ static hosting nào: Dokploy "static site" app, hoặc serve `dist/` bằng chính Node server (`express.static`/`@hono/node-server` serveStatic), hoặc Nginx riêng. Chỉ cần set đúng `VITE_API_BASE` lúc build trỏ vào domain API mới. |
| **`wrangler secret put`** | `worker/src/types.ts` (`Env`) | Biến môi trường thường (`.env` + Dokploy's environment variables UI). Danh sách tên biến cần khai báo giống hệt, xem `README.md` mục "Biến môi trường & secrets". |
| **Migrations** (`wrangler d1 migrations apply`) | `worker/migrations/*.sql`, đánh số `0001`–`0015` | Nếu giữ SQLite: hầu như chạy được nguyên văn bằng bất kỳ SQLite migration runner nào (hoặc script Node đơn giản, đọc lần lượt file theo thứ tự tên). Nếu đổi Postgres: cần viết lại từng file. |
| **Giới hạn subrequest/CPU của Workers** (lý do 1 số code có batch size/chunk cố ý nhỏ — xem `README.md` mục giới hạn kỹ thuật) | `wrangler.jsonc` batch size vars, code chunk `IN (...)` ~90 item | Trên VPS thường không còn giới hạn này — **có thể nới batch size/concurrency lớn hơn để chạy nhanh hơn**, nhưng đây là việc tối ưu thêm sau, không bắt buộc phải đổi ngay để chạy đúng. |

## Kiến trúc đề xuất trên Dokploy

```
┌─────────────────────────────┐
│  Dokploy static site app     │   frontend/dist (build tĩnh)
└──────────────┬───────────────┘
               │ REST API (VITE_API_BASE)
               ▼
┌─────────────────────────────┐
│  Dokploy Node app            │   worker/ chạy qua @hono/node-server
│  (Docker container)          │   + shim waitUntil + adapter DB
└──────────────┬───────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
┌─────────────┐   ┌──────────────────┐
│  SQLite file  │   │  LLM providers    │  (xem README.md — kiểm tra lại
│  (volume) hoặc│   │  hiện tại         │   mạng có gọi được endpoint LLM
│  Postgres     │   └──────────────────┘   hiện tại từ VPS mới không —
└─────────────┘                            xem mục "Rủi ro" bên dưới)

Dokploy Schedules → gọi endpoint nội bộ cho 3 cron job hiện có.
```

## Các bước migrate (checklist)

1. **Export dữ liệu hiện có khỏi D1**:
   ```bash
   npx wrangler d1 export cfl-feedback --remote --output=cfl-feedback-export.sql
   ```
   File này là SQL SQLite chuẩn, import thẳng vào SQLite mới hoặc dùng làm nguồn để chuyển đổi sang Postgres.

2. **Viết lớp adapter DB** thay cho `env.DB` — cùng interface `.prepare(sql).bind(...args).all<T>()/.run()/.first<T>()` để không phải sửa từng file trong `services/`. Đây là phần việc kỹ thuật chính, quyết định effort tổng thể.

3. **Viết entrypoint Node** dùng `@hono/node-server`, import lại đúng `app` (Hono instance) từ `index.ts`, bỏ phần `export default { fetch, scheduled }` kiểu Workers, thay bằng `serve({ fetch: app.fetch, port })`.

4. **Chuyển 3 cron job** (`dailyJob`, `dailySlotResetJob`, `sweepProcessingQueue` — đều đã là hàm `export async function` độc lập trong `index.ts`) sang Dokploy Schedules hoặc `node-cron`, giữ nguyên lịch UTC hiện tại.

5. **Copy toàn bộ tên biến môi trường/secrets** từ `README.md` mục "Biến môi trường & secrets" sang `.env`/Dokploy env var UI. **Giá trị thật phải lấy trực tiếp từ Cloudflare** (`wrangler secret put` không cho đọc lại giá trị đã set — phải hỏi người giữ secret gốc, không có cách nào export tự động).

6. **Build & deploy frontend** như static site, trỏ `VITE_API_BASE` vào domain API mới.

7. **Test lại toàn bộ luồng**: ingest 1 nguồn nhỏ → xem hàng đợi tự chạy classify → taxonomy memory → dịch zh-CN → xem trên Feedback Workspace. Test riêng nút "Xóa run" (xóa cascade nhiều bảng — xem `services/deleteIngestRun.ts`) vì đây là thao tác nhiều bước, dễ lộ lỗi adapter DB nếu transaction không tương thích.

8. **Test khóa admin** (`/api/admin/status`, `/api/admin/unlock`) hoạt động đúng sau khi đổi hạ tầng — logic không phụ thuộc Cloudflare nên chỉ cần đảm bảo header/CORS vẫn đúng.

## Rủi ro cần lưu ý

- **Mạng tới LLM provider**: 2 provider "by Viax" hiện trỏ qua domain tunnel (`agent-shop.clawd.io.vn`, `rpi7jss.abc-tunnel.us`) — cần xác nhận VPS/Dokploy mới có gọi ra được các domain này không (khác gì so với Cloudflare Workers). Ngược lại, nếu VPS mới nằm trong mạng nội bộ VNG, có thể một số endpoint nội bộ VNG lại gọi được trực tiếp mà Cloudflare Workers trước đây không gọi được — nên đánh giá lại toàn bộ lựa chọn provider LLM sau khi đổi hạ tầng, không mặc định giữ y nguyên cấu hình cũ.
- **Transaction DB**: D1 hỗ trợ batch nhưng không có transaction đa-statement đầy đủ như Postgres/SQLite thường — code hiện tại có thể đang dựa vào cách D1 xử lý tuần tự. Khi đổi sang `better-sqlite3`/Postgres (hỗ trợ transaction thật), nên tận dụng transaction thật cho các thao tác nhiều bước (vd xóa run) thay vì giữ nguyên logic tuần tự không transaction.
- **Batch size/concurrency LLM** hiện được tinh chỉnh nhỏ vì giới hạn của Workers VÀ vì bản thân proxy LLM có giới hạn concurrent request riêng (xem comment trong `wrangler.jsonc`) — giới hạn từ phía proxy vẫn còn dù đổi hạ tầng, đừng tăng concurrency chỉ vì "VPS không giới hạn subrequest nữa".
- **`backend/` (FastAPI) không phải lựa chọn thay thế sẵn sàng** — nó là bản cũ, không có các tính năng mới nhất (khóa admin, hàng đợi xử lý nền, cơ chế leo thang LLM, taxonomy memory...). Không nên dùng làm nền migrate trừ khi chấp nhận build lại các tính năng này từ đầu.

## Việc KHÔNG nằm trong tài liệu này

Tài liệu này là **bản đồ + checklist**, không phải code migrate đã viết sẵn. Chưa có: lớp adapter DB thật, entrypoint Node thật, Dockerfile/`docker-compose.yml`, cấu hình Dokploy thật. Đội nhận migrate cần tự viết và test các phần này, dùng `worker/src/services/*.ts` và `worker/src/routes/*.ts` hiện tại làm nguồn logic nghiệp vụ đáng tin cậy nhất (đã có test coverage — `npm test` ở `worker/` — chạy lại test này sau khi đổi adapter DB để bắt lỗi sớm).
