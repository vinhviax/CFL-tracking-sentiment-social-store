# CFL Feedback Intelligence

Web app nội bộ thu thập & phân tích phản hồi người chơi **Crossfire Legends (CFL)** từ:

- **Store** (Google Play + App Store, VN) — qua Sensor Tower API
- **Facebook Fanpage** — qua Facebook Graph API
- **Facebook Group** — qua upload file CSV (chưa có API chính thức)

Mỗi bình luận được LLM phân loại theo **21 chủ đề** (bug, hack/cheat, nạp tiền, ping/mạng,
gameplay, cân bằng game, v.v.) + **sentiment** (tiêu cực/trung lập/tích cực) + **mức độ khẩn cấp**,
lưu vào SQLite và hiển thị qua dashboard React tương tác.

Đặc tả kỹ thuật đầy đủ: [AGENT_BRIEF.md](AGENT_BRIEF.md).

---

## 🚀 Chạy nhanh (từ đầu)

### 1. Backend (FastAPI)

```bash
cd backend
pip install -r requirements.txt
cp ../.env.example ../.env      # điền SENSORTOWER_API_KEY / FB_ACCESS_TOKEN / LLM key nếu có
uvicorn app.main:app --reload --port 8000
```

Không có LLM key vẫn chạy được — hệ thống tự dùng bộ phân loại rule-based (fallback) cho tới khi
bạn cắm key thật vào `.env`. Xem chi tiết tại [backend/README.md](backend/README.md).

### 2. Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

Mở trình duyệt tại địa chỉ Vite in ra (mặc định `http://localhost:5173`).

### 3. Dùng thử

1. Vào trang **Ingest & Cài đặt** → kéo-thả file CSV Group (định dạng như `Daily Detail.csv`) →
  xem preview → xác nhận nạp.
2. Bấm **"Chạy phân loại AI"** để LLM (hoặc fallback) phân loại toàn bộ bình luận mới.
3. Xem kết quả tại trang **Tổng quan**, **Comment Explorer**, hoặc xuất Excel.
4. Muốn kéo dữ liệu **Store**/**Fanpage** thật: điền `SENSORTOWER_API_KEY` / `FB_PAGE_ID` +
  `FB_ACCESS_TOKEN` vào `.env`, sau đó bấm nút tương ứng ở trang Ingest (hoặc để scheduler tự
  chạy hằng ngày theo `SCHEDULE_DAILY_CRON`).

---

## 🏗️ Kiến trúc & trạng thái các phase

| Phase | Nội dung | Trạng thái |
| :-- | :--- | :--- |
| **P1** | Backend skeleton, SQLite, CSV ingest pipeline, LLM adapter đa provider + fallback | ✅ Xong |
| **P2** | Sensor Tower ingest, Facebook Graph ingest, APScheduler tự động hằng ngày | ✅ Xong |
| **P3** | Frontend React 5 trang (Dashboard, Store, Facebook, Comment Explorer, Ingest & Cài đặt) | ✅ Xong |
| **P4** | Insight tổng hợp bằng LLM, export Excel, polish, docs | ✅ Xong |

Chi tiết từng phase, data model, taxonomy, API endpoints: xem [AGENT_BRIEF.md](AGENT_BRIEF.md).

**Lưu ý đã biết:**
- Key Sensor Tower hiện tại trong `key_api.env` đã hết hạn/không hợp lệ (lỗi 401 xác nhận từ
  API) — cần key mới để kéo Store thật. Code đã verify đúng chuẩn API.
- Chưa test Facebook Graph API với token thật (chưa có token khi build) — logic theo đúng chuẩn
  Graph API `v19.0` (pagination, `filter=stream` để lấy cả reply), nhưng cần xác minh với token
  thật trước khi dùng production.
- Trang cài đặt provider LLM hiện ở dạng **xem trạng thái** (đọc từ `.env`), chưa có form đổi
  provider/model trực tiếp trên UI — đổi qua sửa `.env` rồi restart backend.

---

## 📂 Cấu trúc thư mục

```
/backend      FastAPI app (app/main.py, models, routers, services/{sensortower,facebook,csv_ingest,llm})
/frontend     React + Vite SPA (5 trang, Recharts)
/data         SQLite DB (gitignored, tự tạo khi chạy)
AGENT_BRIEF.md   Đặc tả kỹ thuật đầy đủ
.env.example     Mẫu cấu hình — copy thành .env
```

### Script gốc (legacy, độc lập, vẫn chạy được)

Các script Python ban đầu vẫn giữ nguyên ở thư mục gốc, dùng độc lập ngoài web app nếu cần:

| Tên File | Mô tả |
| :--- | :--- |
| [track_comment_CFL_sea.py](track_comment_CFL_sea.py) | Cào review Store SEA (VN/TH/ID/PH) miễn phí, xuất Excel |
| [track_comment_sensortower_VN.py](track_comment_sensortower_VN.py) | Cào review Store qua Sensor Tower (VN), xuất Excel — logic đã được port vào `backend/app/services/sensortower.py` |
| [track_facebook_cfl.py](track_facebook_cfl.py) | Skeleton cào Facebook gốc — logic Graph API thật đã được port vào `backend/app/services/facebook.py` |
| [generate_html_report.py](generate_html_report.py) | Sinh dashboard HTML tĩnh từ file Excel — tiền thân của dashboard React hiện tại |

```bash
pip install pandas openpyxl requests python-dotenv google-play-scraper
python track_comment_CFL_sea.py
python generate_html_report.py <TÊN_FILE_EXCEL>.xlsx
```

---

## 🛡️ Xử lý encoding tiếng Việt (Mojibake)

Toàn bộ code (script gốc lẫn backend mới) đều:
1. Reconfigure `sys.stdout`/`sys.stderr` sang UTF-8 khi chạy trên Windows.
2. Chỉ định rõ `encoding="utf-8"` khi đọc/ghi file.
3. Với file CSV Facebook Group (UTF-16 LE + tab-delimited), backend tự động detect encoding
  (`utf-16` → fallback `utf-8-sig`/`utf-8`) — xem `backend/app/services/csv_ingest.py`.
