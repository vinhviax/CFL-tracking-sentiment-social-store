# HANDOFF — CFL Feedback Intelligence

Bàn giao tiến độ cho agent/session tiếp theo. Kiến trúc, config, secrets, gotcha kỹ thuật nằm ở `MEMORY.md` — file này chỉ ghi **tiến độ và việc cần làm tiếp**, không lặp lại giải thích kiến trúc.

## Trạng thái tại 2026-07-30 (cuối phiên 3), tất cả đã deploy + push

- Commit mới nhất: `1545046` trên `origin/main`, working tree sạch.
- Worker Version `5f30f6c8-4fd8-41de-af6c-3ff658554c85`, Pages `085dc85c`.
- Migration `0015_llm_slot_escalation_state.sql` đã apply lên production.
- Test: worker 255/255, frontend 88/88, `tsc --noEmit` sạch.

| Hạng mục | Số liệu |
|---|---|
| Tổng comment cần xử lý | 59.235 |
| Chưa phân tích LLM | 0 |
| Chưa dịch comment gốc zh-CN | 0 |
| **Chưa dịch summary zh-CN** | **4.323** — xem việc cần làm bên dưới |

## 🎯 Việc đầu tiên cần làm phiên sau

**`pendingTranslations` (`worker/src/services/translation.ts`) không bao giờ chọn lại comment đã có dòng dịch dở dang.** Điều kiện không-force chỉ là `t.comment_id IS NULL`, nên 4.323 comment đã có `message_translated` nhưng `summary_translated` rỗng sẽ bị bỏ qua vĩnh viễn — không phải do rate limit, cron sẽ không tự dọn hết số này.

Cách sửa: nới điều kiện thành `t.comment_id IS NULL OR (summary đã có mà summary_translated rỗng)` — xem chi tiết kỹ thuật đã ghi trong `MEMORY.md` (mục "Luu y bug/han che da gap"). Nhớ thêm test cho điều kiện WHERE của `pendingTranslations` (hiện chưa có). Sau khi sửa, không cần tạo job `comment_ids` + `force:true` thủ công nữa.

## Việc đã hoàn tất phiên 3 (2026-07-30)

1. Cơ chế leo thang LLM có trạng thái cho 2 slot `reasoning`/`simple`, thay hoàn toàn fallback từ khóa/copy nguyên văn cũ — chi tiết kiến trúc ở `MEMORY.md`.
2. 5 bug đã sửa + verify trên production:
   - Hàng đợi xử lý hiện "0/0 comment" cho job chưa tới lượt (`7b44bdf`).
   - Job theo `comment_ids` hiện "Run #null" (`7e0da14`).
   - Feedback Workspace nháy "Chưa có dữ liệu" khi đổi tab (`70d662a`).
   - Ô token của run để trống gây hiểu lầm, giờ phân biệt 3 lý do (`a48e5ee`).
   - `force` dính vĩnh viễn trong `processing_queue`, khiến nút "Phân tích"/"Dịch" quét lại cả run thay vì phần còn thiếu (`1545046`).
3. Xoá 19 dòng `provider='fallback'` di sản (đã phân tích lại bằng LLM thật).
4. Đổi slot Đơn giản dùng `gpt-5.6-luna` làm dự phòng (không phải `gpt-5.6-terra`, tránh trùng model với slot Suy luận).

## Việc còn để ngỏ, chưa làm (không khẩn)

- Hiển thị vị trí hàng đợi dạng danh sách tổng quan hơn.
- Tách 2 run siêu lớn thành job nhỏ hơn để không chiếm slot liên tục — thay đổi kiến trúc, cần bàn với user trước.
- `worker/src/services/llm/fallback.ts` (`classifyFallback`) giờ là code chết (không còn được `classifier.ts` gọi) — có thể xoá nếu muốn dọn dẹp, chưa làm.
