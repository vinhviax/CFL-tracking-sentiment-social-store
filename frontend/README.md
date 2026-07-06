# CFL Feedback Intelligence — Frontend

React (Vite) SPA cho dashboard phân tích feedback Crossfire Legends. Xem đặc tả tổng thể tại
[../AGENT_BRIEF.md](../AGENT_BRIEF.md).

## Chạy

```bash
npm install
npm run dev
```

Mặc định gọi backend tại `http://localhost:8000` (cấu hình qua `VITE_API_BASE` trong
`.env.development`). Cần chạy backend trước — xem [../backend/README.md](../backend/README.md).

## Trang

| Route | Nội dung |
| :-- | :--- |
| `/` | Tổng quan: KPI, xu hướng sentiment, top chủ đề, vấn đề nổi cộm, insight AI |
| `/store` | Rating distribution, so sánh Google Play vs App Store |
| `/facebook` | Tab Fanpage/Group, drill-down bài viết → bình luận |
| `/comments` | Comment Explorer: filter/search toàn văn, phân trang, xuất Excel |
| `/ingest` | Upload CSV, kéo Sensor Tower/Facebook, lịch sử ingest, trạng thái LLM |

## Build production

```bash
npm run build   # ra thư mục dist/
npm run preview # xem thử bản build
```
