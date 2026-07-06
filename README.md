# Project: Crossfire Legends Core Review Scraping & Interactive reporting (Dọn Dẹp & Lọc Core)

> 🚧 **Hướng phát triển tiếp theo**: dự án đang được nâng cấp thành Web App Agent (FastAPI + React + LLM) thu thập & phân tích feedback từ Store (Sensor Tower API), Facebook Fanpage (Graph API) và Facebook Group (CSV upload). Xem đặc tả đầy đủ tại [AGENT_BRIEF.md](AGENT_BRIEF.md).

Dự án này đã được tối ưu hóa và dọn dẹp để chỉ giữ lại các mã nguồn cốt lõi (Core Engine). Thư mục này là nền tảng phục vụ cho việc xây dựng một Agent tự động hóa lấy dữ liệu phản hồi người chơi từ cả Store (Google Play / App Store) và Fanpage Facebook của game **Crossfire Legends** (CFL) rồi xử lý tập trung.

---

## 📂 1. Cấu trúc thư mục cốt lõi (Core Files)

| Tên File | Loại | Mô tả |
| :--- | :--- | :--- |
| [track_comment_CFL_sea.py](file:///g:/CFM/Research/Crossfire%20Legends%20Sea/track_comment_CFL_sea.py) | Python Script | Script cào review Store (Google Play + App Store) cho các quốc gia Đông Nam Á (VN, TH, ID, PH) bằng phương thức công cộng (không cần API Key trả phí). |
| [track_comment_sensortower_VN.py](file:///g:/CFM/Research/Crossfire%20Legends%20Sea/track_comment_sensortower_VN.py) | Python Script | Script cào review Store qua Sensor Tower API cho riêng VN (cần cấu hình API Key trả phí). |
| [track_facebook_cfl.py](file:///g:/CFM/Research/Crossfire%20Legends%20Sea/track_facebook_cfl.py) | Python Script | **[NEW]** Script khung (Skeleton) cào dữ liệu (bài viết, bình luận) từ Fanpage Facebook chính thức của game, tích hợp sẵn mô hình phân loại danh mục lỗi và Sentiment đồng bộ với Store. |
| [generate_html_report.py](file:///g:/CFM/Research/Crossfire%20Legends%20Sea/generate_html_report.py) | Python Script | Script sinh báo cáo giao diện HTML Dashboard tương tác (Interactive Dashboard) từ file Excel báo cáo. |
| [key_api.env](file:///g:/CFM/Research/Crossfire%20Legends%20Sea/key_api.env) | Config File | Lưu trữ API key truy cập Sensor Tower (`SENSORTOWER_API_KEY`). |

---

## 🛠️ 2. Thiết lập môi trường & Chạy dự án

### Cài đặt các thư viện cần thiết:
```bash
pip install pandas openpyxl requests python-dotenv google-play-scraper
```

### Cách chạy cào dữ liệu Store (Public/Free):
```bash
python track_comment_CFL_sea.py
```
*Kết quả:* Tạo ra file Excel dữ liệu `Crossfire_Legends_SEA_Report_YYYYMMDD_HHMM.xlsx`.

### Cách chạy cào dữ liệu Store qua Sensor Tower (Có trả phí):
1. Cấu hình khóa API trong [key_api.env](file:///g:/CFM/Research/Crossfire%20Legends%20Sea/key_api.env).
2. Chạy script:
```bash
python track_comment_sensortower_VN.py
```
*Kết quả:* Tạo ra file Excel dữ liệu `Crossfire_Legends_SensorTower_VN_Report_YYYYMMDD_HHMM.xlsx`.

### Cách chạy thử nghiệm cào dữ liệu Facebook:
```bash
python track_facebook_cfl.py
```
*Kết quả:* Tạo ra file Excel dữ liệu `Crossfire_Legends_Facebook_Report_YYYYMMDD_HHMM.xlsx` (chứa dữ liệu mẫu giả định, sẵn sàng để Agent tích hợp module cào thực tế).

### Sinh báo cáo HTML tương tác:
Chạy script sinh HTML Dashboard bằng cách truyền đường dẫn tới file Excel báo cáo vừa tạo:
```bash
python generate_html_report.py <TÊN_FILE_EXCEL_BÁO_CÁO.xlsx>
```

---

## 🛡️ 3. Biện pháp phòng chống lỗi Mojibake (Lỗi font chữ tiếng Việt)

Để chắc chắn dữ liệu phản hồi (tiếng Việt có dấu, tiếng Thái, Indo) không bị lỗi hiển thị font (Mojibake):
1. **Thiết lập terminal**: Các script Python cốt lõi đều được cài đặt cấu hình tự động reconfigure encoding sang UTF-8 cho dòng xuất chuẩn (`sys.stdout` / `sys.stderr`), tránh lỗi crash khi in ký tự tiếng Việt ra console trên Windows:
   ```python
   import sys
   try:
       sys.stdout.reconfigure(encoding="utf-8")
       sys.stderr.reconfigure(encoding="utf-8")
   except AttributeError:
       pass
   ```
2. **File I/O**: Tất cả các lệnh đọc/ghi file text/HTML đều được chỉ định rõ tham số `encoding="utf-8"`.
3. **Dataframe & Excel Export**: Sử dụng bộ ghi `openpyxl` và `pandas` xử lý trực tiếp Unicode đảm bảo tính toàn vẹn của chuỗi ký tự.
