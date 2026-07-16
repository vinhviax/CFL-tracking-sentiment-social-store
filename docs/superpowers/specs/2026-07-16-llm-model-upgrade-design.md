# Thiết kế nâng cấp model LLM

## Mục tiêu

Nâng model từ GPT-5.4 lên GPT-5.6 cho các tác vụ đã chỉ định, không làm thay đổi provider, endpoint, API key, trạng thái slot hoặc cơ chế fallback.

## Phạm vi cấu hình

| Tác vụ | Giá trị sau thay đổi |
| --- | --- |
| Insight và HTML report | `LLM_INSIGHT_MODEL=codex-lb/gpt-5.6-terra` |
| `reasoning` (phân tích comment, taxonomy/subtopic) | Override D1 đang bật, model `codex-lb/gpt-5.6-terra` |
| `simple` (dịch zh-CN) | Override D1 đang tắt, model lưu là `codex-lb/gpt-5.6-luna` |

Các giá trị khác giữ nguyên. Do slot `simple` vẫn tắt, model dịch thực tế vẫn là model mặc định `ag/gemini-3-flash-agent` cho đến khi slot được bật.

## Thiết kế triển khai

1. Sửa `LLM_INSIGHT_MODEL` trong `worker/wrangler.jsonc` thành Terra rồi deploy Worker để biến môi trường production được cập nhật.
2. Giữ nguyên `LLM_CLASSIFY_MODEL` và `LLM_TRANSLATE_MODEL` mặc định là Gemini Flash Agent.
3. Gọi API cấu hình production để cập nhật model trong hai hàng D1 hiện có, không gửi API key mới để giữ key hiện tại, đồng thời giữ `reasoning.enabled=true` và `simple.enabled=false`.
4. Không sửa code điều phối provider. `reasoning` tiếp tục ưu tiên override; `simple` tiếp tục rơi về giá trị mặc định khi override tắt; Insight/Report tiếp tục dùng trực tiếp `LLM_INSIGHT_MODEL`.

## Kiểm thử và xác nhận

1. Thêm/cập nhật test kiểm chứng Insight model mặc định là Terra và các quy tắc override/fallback không đổi.
2. Chạy focused test LLM config và insight, sau đó typecheck và toàn bộ test Worker trong checkout verify nếu workspace Google Drive không chạy được binary TypeScript.
3. Deploy Worker, gọi `/api/health` và `/api/llm-config` production để xác nhận model/slot cuối cùng.

## Ngoài phạm vi

- Không bật slot `simple`.
- Không đổi endpoint, provider, secret, batch size hay concurrency.
- Không sửa hoặc commit hai file Demo Report đang staged sẵn.
