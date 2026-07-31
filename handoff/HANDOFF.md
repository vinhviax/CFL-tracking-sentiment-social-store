# HANDOFF — CFL Feedback Intelligence

Bàn giao tiến độ cho agent/session tiếp theo. Kiến trúc, config, secrets, gotcha kỹ thuật nằm ở `MEMORY.md` — file này chỉ ghi **tiến độ và việc cần làm tiếp**, không lặp lại giải thích kiến trúc.

## Trạng thái tại 2026-07-31 (cuối phiên 4), tất cả đã deploy + push

- Commit mới nhất: `120ee66` trên `origin/main`, working tree sạch, đã `git fetch` xác nhận J: khớp 100% với remote.
- Worker Version `7ca4b1a5-ffe1-47e6-8152-90815ea098fb`, Pages `fe77d2e7` (production `https://cfl-feedback.pages.dev` trả 200).
- Test: worker 300/300, frontend 98/98, `tsc --noEmit` sạch, `oxlint` sạch, `vite build` sạch — chạy ở `G:\CFM\Research\Crossfire Legends Sea` (đã fast-forward khớp `120ee66`), không phải J:.
- Sản lượng hiện tại (production, `/api/stats/overview`): `total_comments=60312`, `analyzed=59377` (935 chưa phân tích), tiêu cực 28.4%.

## Việc đã hoàn tất phiên 4 (2026-07-31)

**Thêm khóa mật khẩu quản trị cho toàn bộ phần ghi của tab Ingest & Cài đặt**, vì link workspace giờ chia cho nhiều người — họ cần xem được hết nhưng không được thao tác.

1. Biên giới thật nằm ở Worker: `worker/src/services/adminAuth.ts` (middleware `requireAdmin`), mount trong `index.ts` cho `/api/ingest/*`, `/api/llm-config/*`, `/api/analyze/*`, `/api/translate/*`, `/api/runs/*`, `/api/processing/*`. Chỉ chặn method ghi (POST/PUT/PATCH/DELETE) — GET luôn qua nên viewer vẫn xem đủ trạng thái/lịch sử/token, và các GET poll vẫn tự drain hàng đợi xử lý.
2. Endpoint khóa: `GET /api/admin/status` → `{lock_enabled, authorized}`, `POST /api/admin/unlock {password}`. Cả hai không nằm sau `requireAdmin`.
3. Frontend: `AdminLockBar` trên trang Ingest hiện 3 trạng thái (Chưa khóa / Chỉ xem / Đang mở khóa), disable từng nút ghi kèm tooltip lý do. Key giữ ở `sessionStorage` (`frontend/src/utils/adminSession.js`), gửi qua header `X-CFL-Admin-Key`, không bao giờ vào query string.
4. Cố ý **fail-open** khi chưa set `ADMIN_PASSWORD` (mọi người vẫn ghi được), kèm banner đỏ cảnh báo rõ ràng — để tránh deploy code mới tự khóa luôn owner ra ngoài trước khi kịp đặt mật khẩu.
5. Phạm vi khóa **chỉ tab Ingest** — Feedback Workspace (sửa nhãn comment, lưu/xóa insight) vẫn mở như cũ, theo đúng yêu cầu user.
6. User đã tự chạy `wrangler secret put ADMIN_PASSWORD` trên production (từ `G:\CFM\Research\Crossfire Legends Sea\worker`, vì J: bị lỗi thực thi `npx`/`wrangler` — xem mục workflow bên dưới).
7. Verify trên production sau deploy: `lock_enabled: true`; `DELETE /api/runs/*`, `POST /api/ingest/sensortower` không key → 401; `GET /api/runs`, `GET /api/llm-config` không key → vẫn 200.

## 🎯 Việc đầu tiên cần làm phiên sau (kế thừa từ phiên 3, vẫn chưa sửa)

**`pendingTranslations` (`worker/src/services/translation.ts:41`) không bao giờ chọn lại comment đã có dòng dịch dở dang.** Điều kiện không-force chỉ là `t.comment_id IS NULL`, nên các comment đã có `message_translated` nhưng `summary_translated` rỗng sẽ bị bỏ qua vĩnh viễn — không phải do rate limit, cron sẽ không tự dọn hết số này. Đã kiểm tra lại code tại đầu phiên 4: **vẫn còn nguyên, chưa ai sửa**.

Cách sửa: nới điều kiện thành `t.comment_id IS NULL OR (summary đã có mà summary_translated rỗng)` — xem chi tiết kỹ thuật đã ghi trong `MEMORY.md` (mục "Luu y bug/han che da gap"). Nhớ thêm test cho điều kiện WHERE của `pendingTranslations` (hiện chưa có). Sau khi sửa, không cần tạo job `comment_ids` + `force:true` thủ công nữa. Số lượng comment bị ảnh hưởng chưa đo lại trong phiên này (phiên 3 ghi nhận 4.323) — nên đo lại qua trang Ingest hoặc query D1 trước khi ước lượng công sức sửa.

## Workflow làm việc đa ổ đĩa (quan trọng, áp dụng từ phiên 4)

- **Sửa code + `git commit` + `git push`**: làm ở `J:\My Drive\CFL\Agent\Tracking Store Social` (canonical, git thuần chạy bình thường trên Google Drive).
- **Chạy lệnh nặng** (`npm install`, test, build, `wrangler deploy`/`pages deploy`): J: bị treo vô hạn hoặc Windows không nhận diện được binary thực thi qua Google Drive. Thay vào đó sync `G:\CFM\Research\Crossfire Legends Sea` (ổ local, đã là git clone thật) bằng `git checkout main && git pull origin main --ff-only`, cài lại dependency nếu `package.json` đổi, rồi chạy lệnh ở đó. Xong quay lại J: sửa code tiếp — không sửa code trực tiếp trên G:.
- Chi tiết đầy đủ đã lưu vào memory `cfl-run-tests-from-local-mirror`.

## Việc còn để ngỏ, chưa làm (không khẩn)

- Hiển thị vị trí hàng đợi dạng danh sách tổng quan hơn.
- Tách 2 run siêu lớn thành job nhỏ hơn để không chiếm slot liên tục — thay đổi kiến trúc, cần bàn với user trước.
- `worker/src/services/llm/fallback.ts` (`classifyFallback`) vẫn là code chết (không còn được `classifier.ts` gọi) — có thể xoá nếu muốn dọn dẹp, chưa làm.
- `wrangler dev` (local dev server) hiện lỗi `Incorrect type for map entry 'DAILY_INGEST_CRON'` — do `index.ts` export thêm hằng/hàm ngoài default export, bản wrangler 4.107 không chấp nhận kiểu export đó cho local dev (không ảnh hưởng `wrangler deploy`/production). Chưa sửa, không khẩn vì không cản deploy.
