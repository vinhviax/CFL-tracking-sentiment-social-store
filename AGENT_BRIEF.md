# BRIEF: CFL Feedback Intelligence — Web App Agent

> Tài liệu đặc tả cho Agent thực thi (implementation agent). Đọc kỹ toàn bộ trước khi code.
> Ngôn ngữ giao tiếp với user cuối: **Tiếng Việt**. Code/comment: tiếng Anh.

---

## 1. Bối cảnh & Mục tiêu

Team vận hành game **Crossfire Legends (CFL)** của VNG cần một web app nội bộ tự động **thu thập → chuẩn hóa → phân loại (LLM) → phân tích → dashboard** phản hồi người chơi từ 3 nguồn:

| Nguồn | Phương thức | Trạng thái |
| :--- | :--- | :--- |
| **Store** (Google Play + App Store, VN) | Sensor Tower API (key trả phí, đã có) | API sẵn sàng |
| **Facebook Fanpage** | Facebook Graph API (Page Access Token, đã có) | API sẵn sàng |
| **Facebook Group** | User upload file CSV thủ công qua web UI | Chưa có API, chỉ CSV |

Mỗi khi dữ liệu mới về (API pull hoặc CSV upload), hệ thống gọi **LLM phân tích từng comment**: gán chủ đề (taxonomy chi tiết) + sentiment + mức độ khẩn cấp. Kết quả lưu SQLite, hiển thị dashboard tương tác để team theo dõi vấn đề, insight, xu hướng và mức độ hài lòng.

## 2. Quyết định kiến trúc đã chốt (KHÔNG tự thay đổi)

1. **Backend**: FastAPI (Python 3.11+). **Frontend**: React (Vite) + thư viện chart (Recharts hoặc ECharts).
2. **LLM**: lớp adapter đa provider, cấu hình qua `.env` — hỗ trợ **Anthropic Claude** / **OpenAI** / **OpenAI-compatible endpoint nội bộ** (base URL tùy chỉnh). Mặc định đề xuất: Claude Haiku cho phân loại hàng loạt, model lớn hơn cho tổng hợp insight.
3. **Phân loại lại toàn bộ bằng LLM**: bỏ qua nhãn Topic/Sentiment có sẵn trong CSV (cột F trở đi) — LLM gán lại theo taxonomy mới để đồng nhất tiêu chí giữa Store và Facebook. (Có thể lưu nhãn cũ vào cột `legacy_topic` để đối chiếu.)
4. **Lưu trữ**: SQLite (file `data/cfl_feedback.db`). **Scheduler**: APScheduler chạy trong process FastAPI, tự động kéo Sensor Tower + FB Graph **hằng ngày**, sau đó tự chạy pipeline LLM cho dữ liệu mới.

## 3. Tài sản hiện có (tái sử dụng, KHÔNG viết lại từ đầu)

Nằm tại repo này:

- `track_comment_sensortower_VN.py` — logic gọi Sensor Tower đã chạy thực tế:
  - Endpoint: `GET https://api.sensortower.com/v1/{os}/review/get_reviews` với params `app_id`, `country`, date range.
  - App IDs: Google Play `com.vnggames.cfl.crossfirelegends`, App Store `6748588650` (VN).
  - Key đọc từ `key_api.env` → biến `SENSORTOWER_API_KEY`.
  - Có sẵn keyword dict VI/EN cho sentiment rule-based → giữ làm **fallback** khi LLM lỗi/hết quota.
- `track_facebook_cfl.py` — skeleton FB scraper: class `fetch_posts` / `fetch_comments` đã stub sẵn theo Graph API `v19.0/{page_id}/posts` → thay mock bằng call thật (token từ `.env`).
- `track_comment_CFL_sea.py` — scraper store public (google-play-scraper) — giữ làm nguồn dự phòng miễn phí, không bắt buộc tích hợp phase 1.
- `generate_html_report.py` — tham khảo layout/chart của dashboard HTML hiện có để thiết kế UI React (đừng nhúng nguyên file).

## 4. Format file CSV Group (input upload)

File mẫu: `Daily Detail.csv`. **Đặc điểm bắt buộc xử lý đúng:**

- Encoding: **UTF-16 LE có BOM**, delimiter: **TAB** (không phải dấu phẩy). Parser phải auto-detect encoding (thử `utf-16`, fallback `utf-8-sig`) và delimiter.
- 12 cột, nhưng **chỉ lấy 6 cột đầu (A–F)**:

| Cột | Tên | Ý nghĩa |
| :-- | :--- | :--- |
| A | `Source` | `Fanpage` hoặc `Group` |
| B | `Post Published Date` | `dd/mm/yyyy HH:MM:SS` |
| C | `Post Message` | Nội dung bài post gốc (nhiều dòng, có emoji) |
| D | `Created Date ` (có trailing space!) | Thời điểm comment |
| E | `Comment Message` | Nội dung comment — **đây là text chính để LLM phân tích** |
| F | `Topic` | Nhãn cũ → lưu vào `legacy_topic`, không dùng làm kết quả |

- ~4.000 dòng/file. Bỏ qua dòng có `Comment Message` rỗng hoặc chỉ là `...`/tag tên người (vẫn lưu raw nhưng đánh dấu `skipped_analysis=true`).
- Dedupe: hash (`source`, `created_date`, `comment_message`) — upload lại file cũ không được tạo bản ghi trùng hay tốn LLM call lại.

## 5. Taxonomy phân loại (LLM)

Mỗi comment gán **1 topic chính + tối đa 2 topic phụ** từ danh sách sau (cho phép LLM đề xuất nhóm mới vào `other_suggested` nếu thực sự không khớp):

`function`, `ping_network`, `bug`, `event`, `hack_cheat`, `payment_topup`, `login_account`, `performance_lag_crash`, `update_patch`, `customer_support`, `gameplay`, `matchmaking`, `balance`, `reward_gift`, `community_player_behavior`, `item_skin`, `gacha`, `esports_content`, `suggestion_request`, `spam_ads`, `other`

Kèm theo mỗi comment:
- `sentiment`: `negative` / `neutral` / `positive` (hiển thị UI: Tiêu cực / Trung lập / Tích cực)
- `urgency`: `none` / `low` / `medium` / `high` (high = mất tiền, mất account, không vào được game, hack tràn lan)
- `summary`: 1 câu tiếng Việt tóm tắt ý chính (phục vụ tooltip/insight)
- `confidence`: 0–1

**Yêu cầu prompt LLM:**
- Batch **20–50 comment/call** để tiết kiệm chi phí; input đánh số id, output **JSON array đúng schema** (dùng structured output/tool-use nếu provider hỗ trợ; validate bằng Pydantic, retry tối đa 2 lần khi JSON hỏng).
- Prompt kèm ngữ cảnh: đây là game FPS mobile CFL của VNG, comment tiếng Việt teencode/viết tắt nhiều (vd: "văng" = crash, "hút máu" = pay-to-win, "dis" = disconnect, "nạp" = nạp tiền/top-up).
- Với comment từ Facebook, đưa kèm `post_message` (cắt 300 ký tự đầu) làm ngữ cảnh — comment kiểu "sự kiện này lỗi" chỉ hiểu được khi biết post gốc nói về event nào.
- Với review Store, đưa kèm `rating` (1–5 sao) làm tín hiệu.

## 6. Data model (SQLite, dùng SQLAlchemy)

```
ingest_runs(id, source_type[store|fb_page|fb_group_csv], started_at, finished_at,
            status, rows_fetched, rows_new, error)
posts(id, source_type, external_id, published_at, message, permalink, raw_json)
comments(id, post_id FK nullable, source_type, external_id nullable,
         created_at, author_hint nullable, message, rating nullable,
         country, store[gp|ios|null], legacy_topic nullable,
         dedupe_hash UNIQUE, ingest_run_id FK)
analyses(id, comment_id FK UNIQUE, topic_main, topics_sub JSON, sentiment,
         urgency, summary, confidence, provider, model, analyzed_at,
         prompt_version, status[ok|skipped|failed])
```

`prompt_version` bắt buộc — khi đổi prompt/taxonomy có thể re-run chọn lọc.

## 7. Backend API (FastAPI)

```
POST /api/ingest/sensortower        {start_date, end_date, countries?}  → chạy nền, trả run_id
POST /api/ingest/facebook           {since?, until?}                    → kéo posts+comments Fanpage
POST /api/ingest/upload-csv         multipart file                      → parse, dedupe, trả preview + run_id
POST /api/analyze/run               {run_id? | comment_ids? | only_unanalyzed:true}
GET  /api/runs / GET /api/runs/{id}                                     → trạng thái + progress (%)
GET  /api/comments?source&topic&sentiment&urgency&q&from&to&page        → explorer, phân trang
GET  /api/stats/overview?from&to    → tổng comment, % sentiment, top topics, delta vs kỳ trước
GET  /api/stats/trend?granularity=day&topic?                            → time series
GET  /api/insights/summary?from&to  → LLM tổng hợp insight kỳ (model lớn), cache theo tham số
GET  /api/export?format=xlsx&...filters                                 → xuất Excel (tận dụng openpyxl style cũ)
GET/PUT /api/settings               → provider LLM, model, lịch scheduler (không bao giờ trả về giá trị key)
```

Ingest + analyze chạy **background task** (asyncio), UI poll progress qua `/api/runs/{id}`. Analyze phải resumable: crash giữa chừng → chạy lại chỉ xử lý comment chưa có analysis.

## 8. Frontend (React) — 5 trang

1. **Dashboard tổng quan**: KPI cards (tổng feedback, % tiêu cực, delta so kỳ trước), stacked bar sentiment theo ngày, pie/bar top topics, bảng "🔥 Vấn đề nổi cộm" (topic có lượng negative + urgency cao tăng đột biến), khối insight LLM tổng hợp. Filter chung: khoảng ngày + nguồn (Store/Fanpage/Group).
2. **Nguồn Store**: trend theo rating + version (tham khảo logic version segment trong script cũ), so sánh GP vs iOS.
3. **Nguồn Facebook**: tab Fanpage / Group, drill-down từ post → comments của post đó.
4. **Comment Explorer**: bảng full-text search + filter mọi chiều, xem summary LLM, click xuất Excel theo filter hiện tại.
5. **Ingest & Cài đặt**: nút kéo Sensor Tower / FB theo khoảng ngày, khu upload CSV (kéo-thả, hiện preview 10 dòng + báo số dòng mới/trùng trước khi confirm), lịch sử ingest_runs, cấu hình LLM provider + lịch tự động.

UI tiếng Việt, dark/light tùy, ưu tiên rõ ràng hơn đẹp.

## 9. Cấu hình `.env` (tạo `.env.example`, KHÔNG commit `.env` thật)

```env
SENSORTOWER_API_KEY=
FB_PAGE_ID=
FB_ACCESS_TOKEN=            # Page Access Token (long-lived)
LLM_PROVIDER=anthropic      # anthropic | openai | openai_compatible
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
LLM_BASE_URL=               # cho openai_compatible
LLM_CLASSIFY_MODEL=claude-haiku-4-5-20251001
LLM_INSIGHT_MODEL=claude-sonnet-5
SCHEDULE_DAILY_CRON=0 7 * * *   # 7h sáng hằng ngày
DATABASE_URL=sqlite:///data/cfl_feedback.db
```

Migrate `key_api.env` hiện tại vào `.env` chung; giữ tương thích đọc cả hai.

## 10. Ràng buộc & lưu ý bắt buộc

- **Bảo mật**: `.env`, `key_api.env`, `data/`, file xuất `.xlsx` phải nằm trong `.gitignore`. Key Sensor Tower hiện tại đã từng nằm trong file local — tuyệt đối không để lọt vào bất kỳ commit nào.
- **Encoding**: mọi I/O chỉ định UTF-8 rõ ràng; console Windows reconfigure UTF-8 (xem pattern trong README hiện tại). Test với text tiếng Việt có dấu + emoji.
- **Chi phí LLM**: dedupe trước khi analyze; không bao giờ re-analyze comment đã có analysis cùng `prompt_version`; log token usage mỗi run vào `ingest_runs`.
- **FB Graph API**: xử lý pagination (`paging.next`), rate limit (backoff), token hết hạn → báo lỗi rõ ràng trên UI kèm hướng dẫn refresh token. Lấy comments dạng `filter=stream` để bao gồm reply.
- **Sensor Tower**: rate limit theo hợp đồng — thêm sleep giữa các call như script cũ đang làm.
- **PII**: không hiển thị/lưu tên user Facebook đầy đủ nếu tránh được (CSV Group không có cột tên riêng; phần tên lẫn trong comment giữ nguyên nhưng không index).

## 11. Cấu trúc repo đích

```
/backend            # FastAPI app (app/, models/, services/{sensortower,facebook,csv_ingest,llm}/, scheduler)
/frontend           # React + Vite
/legacy             # 4 script Python gốc (di chuyển vào đây, giữ nguyên chạy được)
/docs               # AGENT_BRIEF.md (file này), ghi chú thiết kế
.env.example  .gitignore  README.md  docker-compose.yml (optional phase 2)
```

## 12. Milestones & Acceptance criteria

| Phase | Nội dung | Tiêu chí nghiệm thu |
| :-- | :--- | :--- |
| **P1** | Backend skeleton + DB + CSV upload pipeline + LLM adapter + phân loại | Upload `Daily Detail.csv` → ~3.9k dòng vào DB, dedupe đúng, LLM phân loại xong, query được qua API |
| **P2** | Sensor Tower + FB Graph ingest + scheduler daily | Bấm nút kéo được review VN + post/comment Fanpage thật; cron chạy tự động |
| **P3** | Frontend 5 trang + export Excel | Dashboard hiển thị đúng số liệu đối chiếu với DB; export mở được bằng Excel không lỗi font |
| **P4** | Insight LLM tổng hợp + polish + docs | README hướng dẫn chạy từ zero: `pip install` + `npm install` + 1 lệnh chạy |

Mỗi phase: chạy được thật với dữ liệu thật mới tính xong — không nghiệm thu bằng mock data (trừ khi thiếu API key thì mock rõ ràng, đánh dấu TODO).
