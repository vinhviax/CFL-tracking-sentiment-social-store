# CFL Feedback Intelligence — Backend (Phase 1)

FastAPI backend thu thập & phân tích feedback người chơi Crossfire Legends.
Xem đặc tả tổng thể tại [../AGENT_BRIEF.md](../AGENT_BRIEF.md).

## Trạng thái Phase 1 (đã xong)

- ✅ CSV ingest (Facebook Group/Fanpage) — parse UTF-16/tab, chỉ cột A–F, dedupe bằng hash.
- ✅ Data model SQLite (ingest_runs, posts, comments, analyses) qua SQLAlchemy.
- ✅ LLM adapter đa provider (Anthropic / OpenAI / OpenAI-compatible) + fallback rule-based.
- ✅ Phân loại comment: topic (21 nhóm) + sentiment + urgency + summary, resumable.
- ✅ API: upload/preview CSV, analyze, comments explorer, stats overview/trend, runs.
- ⏳ Phase 2: Sensor Tower + Facebook Graph ingest + scheduler (endpoint hiện trả 501).

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
