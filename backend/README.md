# CFL Feedback Intelligence — Backend

FastAPI backend thu thập & phân tích feedback người chơi Crossfire Legends.
Xem đặc tả tổng thể tại [../AGENT_BRIEF.md](../AGENT_BRIEF.md).

## Trạng thái (P1–P4 đã xong)

- ✅ CSV ingest (Facebook Group) — parse UTF-16/tab, chỉ cột A–F, dedupe bằng hash.
- ✅ Data model SQLite (ingest_runs, posts, comments, analyses) qua SQLAlchemy.
- ✅ LLM adapter đa provider (Anthropic / OpenAI / OpenAI-compatible) + fallback rule-based.
- ✅ Phân loại comment: topic (21 nhóm) + sentiment + urgency + summary, resumable.
- ✅ Sensor Tower ingest (Store, VN) — port từ `track_comment_sensortower_VN.py`.
- ✅ Facebook Graph API ingest (Fanpage, `v19.0`, pagination + replies).
- ✅ APScheduler chạy nền trong process, tự ingest + phân tích hằng ngày theo `SCHEDULE_DAILY_CRON`.
- ✅ Insight tổng hợp bằng LLM (`/api/insights/summary`) + export Excel (`/api/export`).
- ✅ API: upload/preview CSV, ingest sensortower/facebook, analyze, comments explorer, posts,
  stats overview/trend/store, insights, export, runs.

## Chạy

```bash
cd backend
pip install -r requirements.txt          # anthropic/openai chỉ cần khi dùng LLM thật
cp ../.env.example ../.env                # điền key nếu muốn LLM (không có key vẫn chạy fallback)
uvicorn app.main:app --reload --port 8000
```

Mở http://localhost:8000/docs để xem Swagger.

## Thử nhanh pipeline

```bash
# 1. Upload CSV
curl -F "file=@/duong/dan/Daily Detail.csv" http://localhost:8000/api/ingest/upload-csv
# 2. Chạy phân loại (nền) — dùng run_id trả về ở bước 1
curl -X POST http://localhost:8000/api/analyze/run -H "Content-Type: application/json" -d '{"run_id":1}'
# 3. Xem tổng quan
curl http://localhost:8000/api/stats/overview
```

## Ghi chú

- **Không có LLM key** → tự động dùng fallback rule-based (provider=`fallback`, confidence thấp).
  Cắm key vào `.env` (`LLM_PROVIDER` + key tương ứng) là dùng LLM thật ngay, không đổi code.
- **Re-analyze**: chỉ chạy lại comment chưa có analysis ở `PROMPT_VERSION` hiện tại → đổi
  taxonomy/prompt thì bump `PROMPT_VERSION` trong `app/taxonomy.py` rồi gọi lại `/api/analyze/run`.
- **Chi phí**: dedupe trước khi phân tích; upload lại file cũ không tốn LLM call.
- **Sensor Tower**: key hiện tại trong `key_api.env` trả lỗi 401 (hết hạn/không hợp lệ) — cần
  key mới. Logic đã verify đúng chuẩn API (cùng logic với script gốc).
- **Facebook Graph**: chưa test với token thật (build lúc chưa có token) — cần `FB_PAGE_ID` +
  `FB_ACCESS_TOKEN` (long-lived Page Access Token) trong `.env` để kích hoạt.
- **Scheduler**: chạy trong cùng process với `uvicorn --reload`; ở production nên chạy không kèm
  `--reload` (reload có thể spawn nhiều instance scheduler).
