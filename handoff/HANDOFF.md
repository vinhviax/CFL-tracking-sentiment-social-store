# HANDOFF — CFL Feedback Intelligence

Bàn giao tiến độ cho agent/session tiếp theo. Kiến trúc, config, secrets, gotcha kỹ thuật nằm ở `MEMORY.md` — file này chỉ ghi **tiến độ và việc cần làm tiếp**, không lặp lại giải thích kiến trúc.

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

## 🎯 Việc đầu tiên cần làm phiên sau (kế thừa từ phiên 3, vẫn chưa sửa)

**`pendingTranslations` (`worker/src/services/translation.ts:41`) không bao giờ chọn lại comment đã có dòng dịch dở dang.** Điều kiện không-force chỉ là `t.comment_id IS NULL`, nên các comment đã có `message_translated` nhưng `summary_translated` rỗng sẽ bị bỏ qua vĩnh viễn — không phải do rate limit, cron sẽ không tự dọn hết số này. **Vẫn còn nguyên, chưa ai sửa** (đã kiểm tra lại đầu phiên 4 và phiên 5).

Cách sửa: nới điều kiện thành `t.comment_id IS NULL OR (summary đã có mà summary_translated rỗng)` — xem chi tiết kỹ thuật đã ghi trong `MEMORY.md` (mục "Luu y bug/han che da gap"). Nhớ thêm test cho điều kiện WHERE của `pendingTranslations` (hiện chưa có). Sau khi sửa, không cần tạo job `comment_ids` + `force:true` thủ công nữa. Số lượng comment bị ảnh hưởng chưa đo lại (phiên 3 ghi nhận 4.323) — nên đo lại qua trang Ingest hoặc query D1 trước khi ước lượng công sức sửa.

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
