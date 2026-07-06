"""
╔══════════════════════════════════════════════════════════════════╗
║   Crossfire Legends SEA - Review Scraper & Analyzer  v2.2       ║
║   Platforms : Google Play + App Store                            ║
║   Regions   : TH · ID · PH                                      ║
╚══════════════════════════════════════════════════════════════════╝
Changelog v2.2 (Major Improvements):
  - Token cache 24h cho App Store (nhanh hơn 5-10x, ít request hơn)
  - Tất cả keyword thêm \b → giảm false positive đáng kể
  - Category mới: "Lag / Frame Drop" (tách riêng)
  - Sheet mới: "Top_Negative_Keywords" (top 15 từ tiêu cực + ví dụ)
  - Xử lý date + error handling chắc chắn hơn
  - Code sạch, logging rõ ràng hơn
"""

import re
import time
import logging
import json
from datetime import datetime
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
import pandas as pd
from google_play_scraper import reviews, Sort
from openpyxl.styles import PatternFill, Font, Alignment
from openpyxl.utils import get_column_letter

# ─────────────────────────────────────────────────────────────────
# 0. LOGGING
# ─────────────────────────────────────────────────────────────────
current_time = datetime.now().strftime("%Y%m%d_%H%M")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[
        logging.FileHandler(f"scraper_log_{current_time}.txt", encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────
# 1. CONFIG
# ─────────────────────────────────────────────────────────────────
GOOGLE_APP_ID = "com.tencent.stc.cfl"
APPLE_APP_ID  = "6743618701"
OUTPUT_FILE   = f"Crossfire_Legends_SEA_Report_{current_time}.xlsx"
TOKEN_CACHE_FILE = Path("appstore_tokens_cache.json")

START_DATE = datetime(2026, 4, 1)

REGIONS = {
    "TH": {
        "apple": "th", "apple_lang": "th-TH", "google_co": "th", "google_lang": "th",
        "google_id": "com.tencent.stc.cfl", "apple_id": "6743618701"
    },
    "ID": {
        "apple": "id", "apple_lang": "id-ID", "google_co": "id", "google_lang": "id",
        "google_id": "com.tencent.stc.cfl", "apple_id": "6743618701"
    },
    "PH": {
        "apple": "ph", "apple_lang": "en-PH", "google_co": "ph", "google_lang": "en",
        "google_id": "com.tencent.stc.cfl", "apple_id": "6743618701"
    },
    "VN": {
        "apple": "vn", "apple_lang": "vi-VN", "google_co": "vn", "google_lang": "vi",
        "google_id": "com.vnggames.cfl.crossfirelegends", "apple_id": "6748588650"
    }
}

# User-Agent pool
_UA_POOL = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
]
_ua_idx = 0

def _next_ua() -> str:
    global _ua_idx
    ua = _UA_POOL[_ua_idx % len(_UA_POOL)]
    _ua_idx += 1
    return ua

# ─────────────────────────────────────────────────────────────────
# TOKEN CACHE (v2.2)
# ─────────────────────────────────────────────────────────────────
def _load_token_cache() -> dict:
    if TOKEN_CACHE_FILE.exists():
        try:
            with open(TOKEN_CACHE_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def _save_token_cache(cache: dict):
    try:
        with open(TOKEN_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

# ─────────────────────────────────────────────────────────────────
# 2. TỪ ĐIỂN ĐA NGÔN NGỮ (đã thêm \b toàn bộ - v2.2)
# ─────────────────────────────────────────────────────────────────
KEYWORD_DICT = {
    "en": {
        "negative": [
            r"\blag\b", r"\blagging\b", r"\bcrash(es|ed)?\b", r"\bbug(s|gy)?\b",
            r"\bdisconnect(ed|s)?\b", r"\bcheat(er|s)?\b", r"\bhack(er|s)?\b",
            r"\bpay[\s\-]?to[\s\-]?win\b", r"\bp2w\b", r"\bworst\b", r"\bterrible\b",
            r"\bawful\b", r"\bwaste\b", r"\bscam\b", r"\bunplayable\b",
            r"\bfreeze(s|d)?\b", r"\bglitch(es|y)?\b", r"\bstutter(s|ing)?\b",
            r"\bhigh ping\b", r"\bserver (down|issue|error)\b",
        ],
        "positive": [
            r"\bsmooth\b", r"\bgood\b", r"\bgreat\b", r"\bawesome\b",
            r"\blove\b", r"\bnice\b", r"\bbest\b", r"\bfun\b", r"\benjoy\b",
            r"\bperfect\b", r"\bexcellent\b", r"\bamazing\b", r"\bfantastic\b",
            r"\bstable\b", r"\bno lag\b", r"\bno bug\b",
        ],
    },
    "vi": {
        "negative": [
            r"\blag\b", r"\bgiật\b", r"\bvăng\b", r"\blỗi\b", r"\btreo\b",
            r"\bhút máu\b", r"\brác\b", r"\bdis\b(?!cover|play|tance|count)",
            r"\btệ\b", r"\bchán\b", r"\bxấu\b", r"\bnát\b", r"\bxả rác\b",
        ],
        "positive": [
            r"\bmượt\b", r"\bđỉnh\b", r"\bhay\b", r"\bcuốn\b", r"\bvui\b",
            r"\bthích\b", r"\btuyệt\b", r"\bổn\b", r"\bngon\b",
        ],
    },
    "th": {
        "negative": [
            r"\bแลค\b", r"\bปิงสูง\b", r"\bหลุด\b", r"\bเด้ง\b", r"\bบัค\b",
            r"\bโปร\b", r"\bเกลือ\b", r"\bห่วย\b", r"\bแย่มาก\b", r"\bโกง\b",
            r"\bแพงมาก\b", r"\bเข้าไม่ได้\b", r"\bเล่นไม่ได้\b", r"\bหน่วง\b",
            r"\bค้าง\b", r"\bเซิร์ฟเวอร์ล่ม\b", r"\bอัปเดตพัง\b", r"\bปิดตัวเอง\b",
        ],
        "positive": [
            r"\bสนุกมาก\b", r"\bดีมาก\b", r"\bมันส์\b", r"\bสุดยอด\b", r"\bภาพสวย\b",
            r"\bลื่น\b", r"\bชอบ\b", r"\bเยี่ยม\b", r"\bไม่แลค\b", r"\bราบรื่น\b",
        ],
    },
    "id": {
        "negative": [
            r"\bngelag\b", r"\blag\b", r"\bpatah\b", r"\bkeluar sendiri\b",
            r"\bngebug\b", r"\bcit\b", r"\bciter\b", r"\bmahal\b", r"\bampas\b",
            r"\bburik\b", r"\bsusah login\b", r"\bserver mati\b", r"\blemot\b",
            r"\bhang\b", r"\bcrash\b", r"\bboros\b", r"\bgak bisa masuk\b",
            r"\bjelek\b", r"\bparah\b", r"\bbanyak bug\b",
        ],
        "positive": [
            r"\bbagus\b", r"\bkeren\b", r"\bmantap\b", r"\bseru\b",
            r"\blancar\b", r"\bgrafik bagus\b", r"\basyik\b", r"\bcocok\b",
            r"\bstabil\b", r"\btidak lag\b",
        ],
    },
    "ph": {
        "negative": [
            r"\bmalag\b", r"\bnag-crash\b", r"\bpangit\b", r"\bmandurugas\b",
            r"\bumay\b", r"\bsayang\b", r"\bbobo\b", r"\bsira\b", r"\blaging nag\b",
            r"\bhindi gumagana\b", r"\bbumabagsak\b", r"\bscam\b",
        ],
        "positive": [
            r"\bganda\b", r"\bsolid\b", r"\bayos\b", r"\bastig\b", r"\bmaganda\b",
            r"\bmasaya\b", r"\bswabe\b", r"\bwalang lag\b",
        ],
    },
}

NEG_PATTERN = re.compile("|".join(
    token for lang_dict in KEYWORD_DICT.values() for token in lang_dict["negative"]
), re.IGNORECASE)

POS_PATTERN = re.compile("|".join(
    token for lang_dict in KEYWORD_DICT.values() for token in lang_dict["positive"]
), re.IGNORECASE)

def analyze_sentiment(row: pd.Series) -> str:
    rating = int(row.get("rating", 3))
    text   = str(row.get("content", ""))

    if rating <= 2:
        return "Tiêu cực"
    if rating >= 4:
        if NEG_PATTERN.search(text):
            return "Hỗn hợp"
        return "Tích cực"

    has_neg = bool(NEG_PATTERN.search(text))
    has_pos = bool(POS_PATTERN.search(text))
    if has_neg and has_pos:
        return "Hỗn hợp"
    if has_neg:
        return "Tiêu cực"
    if has_pos:
        return "Tích cực"
    return "Trung lập"

# ─────────────────────────────────────────────────────────────────
# 4. PHÂN LOẠI PHẢN HỒI (category) - thêm Lag / Frame Drop
# ─────────────────────────────────────────────────────────────────
CATEGORY_SEVERITY_ORDER = [
    "Hack / Cheat",
    "Bug / Crash",
    "Kết nối / Server",
    "Nạp tiền / Monetization",
    "Lag / Frame Drop",
    "Hiệu năng / Ping",
    "Cân bằng / Gameplay",
    "Đồ họa / Âm thanh",
]

CATEGORY_PATTERNS = {
    "Lag / Frame Drop":      r"lag|lagging|stutter|stuttering|frame drop|drop frame|low fps|fps drop|giật|giật lag|patah|ngelag|malag|แลค|หน่วง|ค้าง|กระตุก|เฟรมเรตตก|fps ตก|nag-i-stutter|bagsak fps",
    "Hiệu năng / Ping":      r"ping|delay|high ping|server (down|issue|error)|ปิง|lemot|server mati|đơ|chậm|load chậm|tải chậm|xoay vòng|đứng hình|latency|slow response|ปิงสูง|ดีเลย์|ช้า|ping tinggi|lelet|ping merah|mataas na ping|mabagal",
    "Bug / Crash":           r"crash|bug|lỗi|treo|văng|out[\s-]?game|keluar|หลุด|เด้ng|เด้ง|บัค|nag-crash|sira|crashing|freeze|freezing|glitch|black screen|stuck|เด้ngออก|เด้งออก|force close|layar hitam|nge-hang|lumalabas",
    "Nạp tiền / Monetization": r"topup|top[\s-]?up|pay[\s-]?to[\s-]?win|p2w|nạp|thanh toán|เติมเงิน|bayar|mahal|แพง|เกลือ|boros|hút máu|recharge|buy|purchase|pay|payment|expensive|greedy|scam|gacha|สุ่มเกลือ|ดูดเงิน|beli|ampas|bili|bayad",
    "Hack / Cheat":          r"\bhack\b|\bcheat|\bmod\b|โปร|cit(?!y)|mandurugas|โกง|hack game|tool hack|auto|cheater|aimbot|wallhack|แฮก|โปรแกรมโกง|suntik",
    "Kết nối / Server":      r"disconnect|server|network|mạng|mất kết nối|เข้าไม่ได้|susah login|server mati|gak bisa masuk|không vào được|lỗi đăng nhập|không đăng nhập|không login|sập|connection|server down|login error|หลุดบ่อย|เชื่อมต่อ|เน็ต|เซิร์ฟล่ม|ล็อกอินไม่ได้|koneksi|jaringan|sinyal|gagal login|susah masuk|koneksyon",
    "Đồ họa / Âm thanh":     r"graphic|visual|sound|music|âm thanh|đồ họa|กราφิก|กราฟิก|grafik|graphics|texture|audio|voice|mute|no sound|ภาพ|เสียง|เพลง|ภาพกาก|ไม่มีเสียง|gambar|suara|tidak ada suara|tunog|boses|musika|walang tunog",
    "Cân bằng / Gameplay":   r"balance|nerf|buff|cân bằng|gameplay|unbalance|overpowered|op\b|mạnh quá|yếu quá|pay to win|p2w|unbalanced|unfair|สมดุล|ไม่สมดุล|โกงเกิน|seimbang|tidak seimbang|balanse|hindi balanse",
}

def categorize_feedback(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["category"] = "Khác"
    df["all_categories"] = "Khác"
    
    # Tạo boolean masks cho mỗi category
    cat_masks = {}
    for cat, pattern in CATEGORY_PATTERNS.items():
        cat_masks[cat] = df["content"].str.contains(pattern, case=False, na=False, regex=True)
        
    # Tạo danh sách rỗng để chứa các category khớp cho mỗi dòng
    all_cats_list = [[] for _ in range(len(df))]
    
    for cat, mask in cat_masks.items():
        for i, matched in enumerate(mask):
            if matched:
                all_cats_list[i].append(cat)
                
    categories = []
    all_categories = []
    
    for matched in all_cats_list:
        if matched:
            primary_cat = min(matched, key=lambda c: CATEGORY_SEVERITY_ORDER.index(c))
            categories.append(primary_cat)
            all_categories.append(", ".join(matched))
        else:
            categories.append("Khác")
            all_categories.append("Khác")
            
    df["category"] = categories
    df["all_categories"] = all_categories
    return df

# ─────────────────────────────────────────────────────────────────
# NEW: Top Negative Keywords (v2.2)
# ─────────────────────────────────────────────────────────────────
def get_top_negative_keywords(master_df: pd.DataFrame, top_n: int = 15) -> pd.DataFrame:
    neg_df = master_df[master_df["sentiment"].isin(["Tiêu cực", "Hỗn hợp"])].copy()
    if neg_df.empty:
        return pd.DataFrame(columns=["keyword", "count", "lang", "example"])

    text_series = neg_df["content"].fillna("").str.lower()
    stats = []

    for lang_name, lang_dict in KEYWORD_DICT.items():
        for raw_pat in lang_dict["negative"]:
            pat = re.compile(raw_pat, re.IGNORECASE)
            matches = text_series.str.contains(pat, na=False)
            count = int(matches.sum())
            if count > 0:
                example_idx = matches[matches].index[0]
                example_text = neg_df.loc[example_idx, "content"]
                example = (example_text[:100] + "...") if len(example_text) > 100 else example_text
                display = re.sub(r'\\b|\\\(.*?\\\)|\^|\$', '', raw_pat).strip()
                stats.append({
                    "keyword": display or raw_pat,
                    "count": count,
                    "lang": lang_name.upper(),
                    "example": example
                })

    df_kw = pd.DataFrame(stats)
    df_kw = df_kw.sort_values("count", ascending=False).head(top_n).reset_index(drop=True)
    return df_kw

# ─────────────────────────────────────────────────────────────────
# 5. FETCHERS
# ─────────────────────────────────────────────────────────────────
def get_google_reviews(app_id: str, region_code: str, lang: str, country: str, start_date: datetime) -> pd.DataFrame:
    log.info(f"Google Play [{region_code}] — bắt đầu lấy reviews từ {start_date.strftime('%Y-%m-%d')}...")
    all_results = []
    token = None
    page_size = 200
    start_date_naive = start_date.replace(tzinfo=None)

    while True:
        try:
            result, token = reviews(
                app_id, lang=lang, country=country,
                sort=Sort.NEWEST, count=page_size,
                continuation_token=token
            )
            if not result:
                break
            
            page_done = False
            for r in result:
                review_date = r["at"]
                if review_date.tzinfo is not None:
                    review_date = review_date.replace(tzinfo=None)
                if review_date < start_date_naive:
                    page_done = True
                    break
            
            all_results.extend(result)
            if page_done or not token:
                break
                
            time.sleep(1.5)
        except Exception as exc:
            log.warning(f"Google Play [{region_code}] lỗi khi cào trang: {exc}")
            break

    if not all_results:
        return pd.DataFrame()

    df = pd.DataFrame(all_results)[["userName", "score", "content", "at"]]
    df.rename(columns={"userName": "author", "score": "rating"}, inplace=True)
    df["Region"] = region_code
    df["Store"]  = "Google Play"
    
    df["at_naive"] = pd.to_datetime(df["at"]).dt.tz_localize(None)
    df = df[df["at_naive"] >= start_date_naive].copy()
    df.drop(columns=["at_naive"], inplace=True)

    log.info(f"Google Play [{region_code}] — lấy được {len(df)} reviews từ {start_date.strftime('%Y-%m-%d')}.")
    return df

# Desktop UA cho App Store
_DESKTOP_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) "
    "Version/17.4.1 Safari/605.1.15"
)
_JWT_RE = re.compile(r'(eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)')

def _fetch_html_for_token(app_id: str, country: str) -> str | None:
    candidate_urls = [
        f"https://apps.apple.com/{country}/app/crossfire-legends/id{app_id}",
        f"https://apps.apple.com/{country}/app/id{app_id}",
        f"https://apps.apple.com/{country}/app/crossfire-legends/id{app_id}?platform=web",
    ]
    headers = {
        "User-Agent": _DESKTOP_UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    for url in candidate_urls:
        try:
            probe = requests.get(url, headers=headers, timeout=15, allow_redirects=False)
            if probe.status_code in (301, 302, 307, 308):
                loc = probe.headers.get("Location", "")
                if loc.startswith("itms-appss://") or loc.startswith("itms-apps://"):
                    continue
                res = requests.get(loc, headers=headers, timeout=15)
            elif probe.status_code == 200:
                res = probe
            else:
                continue

            if res.status_code == 200 and len(res.text) > 1000:
                return res.text
        except Exception:
            continue
    return None

def _get_appstore_token(app_id: str, country: str) -> str | None:
    cache = _load_token_cache()
    cache_key = f"{country}_{app_id}"
    now = datetime.now().timestamp()

    if cache_key in cache:
        cached = cache[cache_key]
        if now - cached.get("timestamp", 0) < 86400:  # 24 giờ
            log.info(f"Token [{country}] ✓ from cache (24h).")
            return cached["token"]

    log.info(f"Token [{country}] — fetching new token...")
    html = _fetch_html_for_token(app_id, country)
    if not html:
        log.warning(f"Token [{country}] — không lấy được HTML.")
        return None

    from urllib.parse import unquote
    meta_match = re.search(
        r'<meta[^>]+name="web-experience-app/config/environment"[^>]+content="([^"]+)"',
        html,
    )
    if meta_match:
        decoded = unquote(meta_match.group(1))
        tok = re.search(r'"token"\s*:\s*"(eyJ[^"]+)"', decoded)
        if tok:
            token = tok.group(1)
            cache[cache_key] = {"token": token, "timestamp": now}
            _save_token_cache(cache)
            log.info(f"Token [{country}] ✓ via meta tag (saved to cache).")
            return token

    candidates = _JWT_RE.findall(html)
    valid = [c for c in candidates if len(c) > 100]
    if valid:
        token = max(valid, key=len)
        cache[cache_key] = {"token": token, "timestamp": now}
        _save_token_cache(cache)
        log.info(f"Token [{country}] ✓ via inline JWT (saved to cache).")
        return token

    log.warning(f"Token [{country}] — không tìm thấy JWT.")
    return None

def fetch_appstore_reviews_rss(app_id: str, region_code: str, country: str, start_date: datetime, lang: str = "en-US") -> pd.DataFrame:
    log.info(f"App Store [{region_code}] — Thử cào bằng RSS feed công cộng...")
    all_rows = []
    start_date_naive = start_date.replace(tzinfo=None)

    for page in range(1, 11):
        url = f"https://itunes.apple.com/{country}/rss/customerreviews/page={page}/id={app_id}/sortby=mostrecent/json"
        try:
            res = requests.get(url, timeout=15)
            if res.status_code != 200:
                log.warning(f"App Store [{region_code}] RSS page {page} lỗi HTTP {res.status_code}")
                break

            data = res.json()
            entries = data.get("feed", {}).get("entry", [])
            if not entries:
                break

            if page == 1:
                if len(entries) > 1:
                    entries = entries[1:]
                else:
                    break

            page_done = False
            for entry in entries:
                try:
                    date_str = entry.get("updated", {}).get("label", "")
                    review_date = pd.to_datetime(date_str).tz_localize(None)
                except Exception:
                    review_date = pd.NaT

                if pd.notna(review_date) and review_date < start_date_naive:
                    page_done = True
                    break

                author = entry.get("author", {}).get("name", {}).get("label", "Anonymous")
                rating = int(entry.get("im:rating", {}).get("label", 0))
                title = entry.get("title", {}).get("label", "")
                content = entry.get("content", {}).get("label", "")

                full_content = content
                if title:
                    full_content = f"{title} - {content}"

                all_rows.append({
                    "author": author,
                    "rating": rating,
                    "content": full_content,
                    "at": date_str,
                    "Region": region_code,
                    "Store": "App Store",
                })

            if page_done:
                break

            time.sleep(1.5)
        except Exception as exc:
            log.warning(f"App Store [{region_code}] RSS page {page} gặp lỗi: {exc}")
            break

    df = pd.DataFrame(all_rows)
    if not df.empty:
        df["at_naive"] = pd.to_datetime(df["at"]).dt.tz_localize(None)
        df = df[df["at_naive"] >= start_date_naive].copy()
        df.drop(columns=["at_naive"], inplace=True)
    log.info(f"App Store [{region_code}] RSS — lấy được {len(df)} reviews.")
    return df

def fetch_appstore_reviews(app_id: str, region_code: str, country: str, start_date: datetime, lang: str = "en-US") -> pd.DataFrame:
    log.info(f"App Store [{region_code}] — lấy token...")
    token = _get_appstore_token(app_id, country)
    if not token:
        log.warning(f"App Store [{region_code}] — không lấy được token, chuyển sang fallback RSS...")
        return fetch_appstore_reviews_rss(app_id, region_code, country, start_date, lang)

    log.info(f"App Store [{region_code}] — bắt đầu scrape từ {start_date.strftime('%Y-%m-%d')}...")
    all_rows: list[dict] = []
    offset = 0
    page_size = 20
    retries_limit = 4
    token_refreshed = False
    start_date_naive = start_date.replace(tzinfo=None)

    while True:
        url = f"https://amp-api.apps.apple.com/v1/catalog/{country}/apps/{app_id}/reviews"
        params = {
            "l": lang, "offset": offset, "limit": page_size,
            "platform": "web", "additionalPlatforms": "appletv,ipad,iphone,mac",
        }
        headers = {
            "Authorization": f"Bearer {token}",
            "User-Agent": _DESKTOP_UA,
            "Origin": "https://apps.apple.com",
            "Referer": f"https://apps.apple.com/{country}/app/crossfire-legends/id{app_id}",
        }

        retries = 0
        res = None
        while retries < retries_limit:
            try:
                res = requests.get(url, params=params, headers=headers, timeout=15)
                if res.status_code == 200:
                    break
                elif res.status_code == 401 and not token_refreshed:
                    log.warning(f"App Store [{region_code}] 401 — refresh token...")
                    new_token = _get_appstore_token(app_id, country)
                    if new_token and new_token != token:
                        token = new_token
                        headers["Authorization"] = f"Bearer {token}"
                        token_refreshed = True
                        continue
                    return pd.DataFrame(all_rows)
                elif res.status_code == 429:
                    wait = 2 ** retries * 5
                    log.warning(f"App Store [{region_code}] rate-limit, chờ {wait}s...")
                    time.sleep(wait)
                    retries += 1
                else:
                    log.warning(f"App Store [{region_code}] offset={offset}: HTTP {res.status_code}")
                    break
            except Exception as exc:
                log.warning(f"App Store [{region_code}] exception: {exc}")
                retries += 1
                time.sleep(3)

        if res is None or res.status_code != 200:
            break

        data = res.json()
        entries = data.get("data", [])
        if not entries:
            break

        page_done = False
        for entry in entries:
            attr = entry.get("attributes", {})
            date_str = attr.get("date", "")
            try:
                review_date = pd.to_datetime(date_str).tz_localize(None)
            except Exception:
                review_date = pd.NaT

            if pd.notna(review_date) and review_date < start_date_naive:
                page_done = True
                break

            all_rows.append({
                "author": attr.get("reviewerNickname", "Anonymous"),
                "rating": int(attr.get("rating", 0)),
                "content": attr.get("body", ""),
                "at": attr.get("date", pd.NaT),
                "Region": region_code,
                "Store": "App Store",
            })

        if page_done or not data.get("next"):
            break
        offset += page_size
        time.sleep(1.5)

    df = pd.DataFrame(all_rows)
    if not df.empty:
        df["at_naive"] = pd.to_datetime(df["at"]).dt.tz_localize(None)
        df = df[df["at_naive"] >= start_date_naive].copy()
        df.drop(columns=["at_naive"], inplace=True)

    log.info(f"App Store [{region_code}] — lấy được {len(df)} reviews.")
    return df

# ─────────────────────────────────────────────────────────────────
# FETCH ALL REGIONS
# ─────────────────────────────────────────────────────────────────
def fetch_region(region: str, config: dict) -> list[pd.DataFrame]:
    dfs = []
    google_id = config.get("google_id", GOOGLE_APP_ID)
    apple_id = config.get("apple_id", APPLE_APP_ID)
    
    df_gp = get_google_reviews(
        google_id, region,
        config["google_lang"], config["google_co"], START_DATE
    )
    df_ios = fetch_appstore_reviews(
        apple_id, region,
        country=config["apple"],
        lang=config["apple_lang"],
        start_date=START_DATE,
    )
    if not df_gp.empty:  dfs.append(df_gp)
    if not df_ios.empty: dfs.append(df_ios)
    return dfs

# ─────────────────────────────────────────────────────────────────
# EXCEL STYLING
# ─────────────────────────────────────────────────────────────────
SENTIMENT_COLORS = {
    "Tiêu cực": "FFCCCC", "Tích cực": "CCFFCC",
    "Hỗn hợp": "FFF2CC", "Trung lập": "E0E0E0",
}

def _auto_column_width(ws):
    for col in ws.columns:
        max_len = max((len(str(cell.value)) for cell in col if cell.value), default=10)
        ws.column_dimensions[get_column_letter(col[0].column)].width = min(max_len + 4, 60)

def _style_header(ws, fill_hex="2C3E50"):
    fill = PatternFill("solid", fgColor=fill_hex)
    font = Font(bold=True, color="FFFFFF")
    for cell in ws[1]:
        cell.fill = fill
        cell.font = font
        cell.alignment = Alignment(horizontal="center", vertical="center")

def style_raw_sheet(ws, sentiment_col_idx: int):
    _style_header(ws)
    for row in ws.iter_rows(min_row=2):
        sentiment_val = row[sentiment_col_idx - 1].value
        hex_color = SENTIMENT_COLORS.get(str(sentiment_val), "FFFFFF")
        fill = PatternFill("solid", fgColor=hex_color)
        for cell in row:
            cell.fill = fill

def generate_overview_assessment(master_df: pd.DataFrame):
    gp_df = master_df[master_df["Store"] == "Google Play"]
    as_df = master_df[master_df["Store"] == "App Store"]
    
    gp_total = len(gp_df)
    gp_avg_rating = gp_df["rating"].mean() if gp_total > 0 else 0
    gp_pos = len(gp_df[gp_df["sentiment"] == "Tích cực"])
    gp_neg = len(gp_df[gp_df["sentiment"] == "Tiêu cực"])
    gp_mix = len(gp_df[gp_df["sentiment"] == "Hỗn hợp"])
    
    gp_pos_pct = (gp_pos / gp_total * 100) if gp_total > 0 else 0
    gp_neg_pct = (gp_neg / gp_total * 100) if gp_total > 0 else 0
    
    gp_neg_df = gp_df[gp_df["sentiment"].isin(["Tiêu cực", "Hỗn hợp"])]
    if not gp_neg_df.empty:
        gp_top_cats = gp_neg_df["category"].value_counts()
        gp_top_cats_clean = gp_top_cats.drop("Khác", errors="ignore")
        gp_top_issue = gp_top_cats_clean.index[0] if not gp_top_cats_clean.empty else (gp_top_cats.index[0] if not gp_top_cats.empty else "Không có")
    else:
        gp_top_issue = "Không có"
        
    as_total = len(as_df)
    as_avg_rating = as_df["rating"].mean() if as_total > 0 else 0
    as_pos = len(as_df[as_df["sentiment"] == "Tích cực"])
    as_neg = len(as_df[as_df["sentiment"] == "Tiêu cực"])
    as_mix = len(as_df[as_df["sentiment"] == "Hỗn hợp"])
    
    as_pos_pct = (as_pos / as_total * 100) if as_total > 0 else 0
    as_neg_pct = (as_neg / as_total * 100) if as_total > 0 else 0
    
    as_neg_df = as_df[as_df["sentiment"].isin(["Tiêu cực", "Hỗn hợp"])]
    if not as_neg_df.empty:
        as_top_cats = as_neg_df["category"].value_counts()
        as_top_cats_clean = as_top_cats.drop("Khác", errors="ignore")
        as_top_issue = as_top_cats_clean.index[0] if not as_top_cats_clean.empty else (as_top_cats.index[0] if not as_top_cats.empty else "Không có")
    else:
        as_top_issue = "Không có"
        
    gp_text = ""
    if gp_total > 0:
        gp_text = f"Cửa hàng Google Play ghi nhận tổng cộng {gp_total} đánh giá với điểm số trung bình là {gp_avg_rating:.2f}/5 sao. "
        if gp_neg_pct > 30:
            gp_text += f"Tỷ lệ phản hồi tiêu cực khá cao ({gp_neg_pct:.1f}%), cho thấy người dùng đang gặp nhiều ức chế. "
        else:
            gp_text += f"Trải nghiệm người dùng tương đối ổn định với tỷ lệ tiêu cực chiếm {gp_neg_pct:.1f}%. "
            
        if gp_top_issue != "Không có" and gp_top_issue != "Khác":
            gp_text += f"Vấn đề nổi cộm nhất cần lưu ý là lỗi thuộc nhóm '{gp_top_issue}', đây là nguyên nhân trực tiếp làm sụt giảm điểm số và khiến người chơi dễ rời bỏ game (drop game)."
    else:
        gp_text = "Không có dữ liệu đánh giá trên Google Play trong khoảng thời gian này."

    as_text = ""
    if as_total > 0:
        as_text = f"Cửa hàng App Store ghi nhận tổng cộng {as_total} đánh giá với điểm số trung bình là {as_avg_rating:.2f}/5 sao. "
        if as_neg_pct > 30:
            as_text += f"Tỷ lệ phản hồi tiêu cực trên iOS ở mức cao ({as_neg_pct:.1f}%), đòi hỏi đội ngũ vận hành cần kiểm tra tính tương thích thiết bị. "
        else:
            as_text += f"Người dùng iOS phản hồi tích cực hơn với tỷ lệ tiêu cực ở mức thấp ({as_neg_pct:.1f}%). "
            
        if as_top_issue != "Không có" and as_top_issue != "Khác":
            as_text += f"Vấn đề lớn nhất trên App Store tập trung vào nhóm '{as_top_issue}', gây ảnh hưởng tiêu cực đến trải nghiệm chơi game của người dùng."
    else:
        as_text = "Không có dữ liệu đánh giá trên App Store trong khoảng thời gian này."

    rec_text = "Dựa trên phân tích dữ liệu phản hồi tiêu cực của cả hai nền tảng:\n"
    recommendations = []
    
    all_neg_cats = master_df[master_df["sentiment"].isin(["Tiêu cực", "Hỗn hợp"])]["category"].value_counts()
    all_neg_cats_clean = all_neg_cats.drop("Khác", errors="ignore")
    
    if not all_neg_cats_clean.empty:
        top_overall_issue = all_neg_cats_clean.index[0]
        recommendations.append(f"1. Khắc phục khẩn cấp vấn đề thuộc nhóm '{top_overall_issue}' vì đây là nguồn gây tiêu cực lớn nhất hệ thống.")
        
        if "Hack / Cheat" in all_neg_cats_clean.index:
            recommendations.append("2. Tăng cường hệ thống chống gian lận (Anti-cheat), quét mã độc và cập nhật các bản vá bảo mật để bảo vệ môi trường công bằng cho người chơi.")
        if "Bug / Crash" in all_neg_cats_clean.index or "Kết nối / Server" in all_neg_cats_clean.index:
            recommendations.append("3. Tối ưu hóa kết nối máy chủ, giảm thiểu tình trạng ngắt kết nối giữa trận (disconnect) và kiểm tra lại log crash trên các dòng máy cấu hình thấp.")
        if "Nạp tiền / Monetization" in all_neg_cats_clean.index:
            recommendations.append("4. Rà soát lại cổng thanh toán tự động, rút ngắn thời gian xử lý khiếu nại nạp tiền của người chơi để tránh các cáo buộc 'hút máu' hoặc lừa đảo.")
        if "Lag / Frame Drop" in all_neg_cats_clean.index or "Hiệu năng / Ping" in all_neg_cats_clean.index:
            recommendations.append("5. Điều chỉnh tối ưu hóa hiệu năng game (optimization), giảm giật lag và giảm dung lượng tài nguyên cập nhật ban đầu.")
    else:
        recommendations.append("1. Duy trì chất lượng vận hành hiện tại, tiếp tục theo dõi định kỳ để phản ứng nhanh với các lỗi phát sinh sau các bản cập nhật tiếp theo.")

    rec_text += "\n".join(recommendations)
    
    stats_data = {
        "Nền tảng (Store)": ["Google Play", "App Store"],
        "Tổng số đánh giá (Total Reviews)": [gp_total, as_total],
        "Điểm đánh giá TB (Avg Rating)": [round(gp_avg_rating, 2), round(as_avg_rating, 2)],
        "Tỷ lệ Tích cực (Positive %)": [f"{gp_pos_pct:.1f}%", f"{as_pos_pct:.1f}%"],
        "Tỷ lệ Tiêu cực (Negative %)": [f"{gp_neg_pct:.1f}%", f"{as_neg_pct:.1f}%"],
        "Vấn đề chính (Top Issue)": [gp_top_issue, as_top_issue]
    }
    df_stats = pd.DataFrame(stats_data)
    
    return df_stats, gp_text, as_text, rec_text


def write_excel(master_df: pd.DataFrame, bad_df: pd.DataFrame, top_keywords_df: pd.DataFrame, output_path: str):
    summary_pivot = pd.pivot_table(
        master_df, values="content", index="Region", columns="Store",
        aggfunc="count", fill_value=0
    ).reset_index()
    summary_pivot["Total"] = summary_pivot.drop(columns="Region").sum(axis=1)

    sentiment_dist = (
        master_df.groupby(["Region", "sentiment"]).size()
        .unstack(fill_value=0).reset_index()
    )

    rating_dist = (
        master_df.groupby(["Region", "Store", "rating"])
        .size().reset_index(name="count")
    )

    category_dist = (
        master_df[master_df["sentiment"] == "Tiêu cực"]
        .groupby(["Region", "category"]).size()
        .reset_index(name="count")
        .sort_values(["Region", "count"], ascending=[True, False])
    )

    df_stats, gp_text, as_text, rec_text = generate_overview_assessment(master_df)

    with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
        # 1. Tạo sheet trống đầu tiên cho báo cáo tổng hợp
        wb = writer.book
        # openpyxl khởi tạo sẽ có sẵn 1 sheet mặc định
        ws_ov = wb.create_sheet(title="Overview_&_Assessment")
        
        # Tiêu đề lớn
        ws_ov.merge_cells("A1:F1")
        ws_ov["A1"] = "BÁO CÁO TỔNG QUAN & ĐÁNH GIÁ TRẢI NGHIỆM NGƯỜI DÙNG"
        ws_ov["A1"].font = Font(bold=True, size=14, color="1F4E79")
        ws_ov["A1"].alignment = Alignment(horizontal="center", vertical="center")
        
        ws_ov.merge_cells("A2:F2")
        ws_ov["A2"] = f"Dữ liệu thu thập từ ngày {START_DATE.strftime('%d/%m/%Y')} đến nay"
        ws_ov["A2"].font = Font(italic=True, size=10, color="595959")
        ws_ov["A2"].alignment = Alignment(horizontal="center", vertical="center")
        
        # Bảng thống kê (Dòng 4)
        ws_ov["A4"] = "1. BẢNG THỐNG KÊ CHỈ SỐ THEO NỀN TẢNG"
        ws_ov["A4"].font = Font(bold=True, size=11, color="2C3E50")
        
        # Ghi các tiêu đề cột bảng stats (dòng 5)
        headers_stats = list(df_stats.columns)
        for c_idx, h in enumerate(headers_stats, 1):
            cell = ws_ov.cell(row=5, column=c_idx)
            cell.value = h
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="2C3E50")
            cell.alignment = Alignment(horizontal="center", vertical="center")
            
        # Ghi dữ liệu bảng stats (dòng 6 và 7)
        for r_idx, row in enumerate(df_stats.values, 6):
            for c_idx, val in enumerate(row, 1):
                cell = ws_ov.cell(row=r_idx, column=c_idx)
                cell.value = val
                cell.alignment = Alignment(horizontal="center", vertical="center")
                # Thêm viền nhẹ
                from openpyxl.styles import Border, Side
                thin = Side(border_style="thin", color="D3D3D3")
                cell.border = Border(top=thin, left=thin, right=thin, bottom=thin)
                if r_idx % 2 == 1:
                    cell.fill = PatternFill("solid", fgColor="F2F4F4")

        # Viết nhận xét Google Play (bắt đầu từ dòng 9)
        ws_ov["A9"] = "2. PHÂN TÍCH CHI TIẾT CỬA HÀNG GOOGLE PLAY"
        ws_ov["A9"].font = Font(bold=True, size=11, color="2C3E50")
        
        ws_ov.merge_cells("A10:F11")
        ws_ov["A10"] = gp_text
        ws_ov["A10"].alignment = Alignment(wrap_text=True, vertical="top")
        ws_ov["A10"].font = Font(size=10)
        ws_ov["A10"].fill = PatternFill("solid", fgColor="EBF5FB")
        
        # Viết nhận xét App Store (bắt đầu từ dòng 13)
        ws_ov["A13"] = "3. PHÂN TÍCH CHI TIẾT CỬA HÀNG APP STORE"
        ws_ov["A13"].font = Font(bold=True, size=11, color="2C3E50")
        
        ws_ov.merge_cells("A14:F15")
        ws_ov["A14"] = as_text
        ws_ov["A14"].alignment = Alignment(wrap_text=True, vertical="top")
        ws_ov["A14"].font = Font(size=10)
        ws_ov["A14"].fill = PatternFill("solid", fgColor="FEF9E7")
        
        # Viết khuyến nghị (bắt đầu từ dòng 17)
        ws_ov["A17"] = "4. KHUYẾN NGHỊ VẬN HÀNH & TỐI ƯU TRẢI NGHIỆM (ĐỂ GIẢM DROP GAME)"
        ws_ov["A17"].font = Font(bold=True, size=11, color="C0392B")
        
        ws_ov.merge_cells("A18:F23")
        ws_ov["A18"] = rec_text
        ws_ov["A18"].alignment = Alignment(wrap_text=True, vertical="top")
        ws_ov["A18"].font = Font(size=10, color="1C2833")
        ws_ov["A18"].fill = PatternFill("solid", fgColor="FDEDEC")
        
        # Cấu hình kích thước cột cho Overview sheet
        ws_ov.column_dimensions["A"].width = 25
        ws_ov.column_dimensions["B"].width = 20
        ws_ov.column_dimensions["C"].width = 20
        ws_ov.column_dimensions["D"].width = 20
        ws_ov.column_dimensions["E"].width = 20
        ws_ov.column_dimensions["F"].width = 25
        ws_ov.row_dimensions[10].height = 22
        ws_ov.row_dimensions[11].height = 22
        ws_ov.row_dimensions[14].height = 22
        ws_ov.row_dimensions[15].height = 22
        ws_ov.row_dimensions[18].height = 22
        ws_ov.row_dimensions[19].height = 22
        ws_ov.row_dimensions[20].height = 22
        ws_ov.row_dimensions[21].height = 22
        ws_ov.row_dimensions[22].height = 22
        ws_ov.row_dimensions[23].height = 22

        # Ghi các sheet còn lại như cũ
        col_order = ["author", "rating", "content", "at", "Region", "Store", "sentiment", "category", "all_categories"]
        master_df[col_order].to_excel(writer, sheet_name="Raw_Data_SEA", index=False)
        bad_df[col_order].to_excel(writer, sheet_name="Negative_Alerts", index=False)
        summary_pivot.to_excel(writer, sheet_name="Region_Summary", index=False)
        sentiment_dist.to_excel(writer, sheet_name="Sentiment_Summary", index=False)
        rating_dist.to_excel(writer, sheet_name="Rating_Distribution", index=False)
        category_dist.to_excel(writer, sheet_name="Top_Issues", index=False)

        if not top_keywords_df.empty:
            top_keywords_df.to_excel(writer, sheet_name="Top_Negative_Keywords", index=False)

        # Xóa sheet mặc định "Sheet" nếu có để tránh trống
        if "Sheet" in wb.sheetnames:
            wb.remove(wb["Sheet"])

        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            if sheet_name == "Overview_&_Assessment":
                continue
            elif sheet_name in ["Raw_Data_SEA", "Negative_Alerts"]:
                sentiment_col = col_order.index("sentiment") + 1
                style_raw_sheet(ws, sentiment_col)
            else:
                _style_header(ws)
            _auto_column_width(ws)


# ─────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except AttributeError:
        pass

    log.info("═" * 60)
    log.info("  Crossfire Legends SEA Review Scraper v2.2  STARTED")
    log.info("═" * 60)

    all_dfs: list[pd.DataFrame] = []

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(fetch_region, region, config): region
            for region, config in REGIONS.items()
        }
        for future in as_completed(futures):
            region = futures[future]
            try:
                dfs = future.result()
                all_dfs.extend(dfs)
                log.info(f"[{region}] hoàn tất, {sum(len(d) for d in dfs)} dòng.")
            except Exception as exc:
                log.error(f"[{region}] thất bại: {exc}")

    if not all_dfs:
        log.error("❌ Không lấy được dữ liệu nào.")
    else:
        master_df = pd.concat(all_dfs, ignore_index=True)
        log.info(f"Tổng raw: {len(master_df)} reviews trước dedup.")

        master_df.drop_duplicates(subset=["author", "content", "at"], inplace=True)
        log.info(f"Sau dedup: {len(master_df)} reviews.")

        # Sanitize columns starting with '=' to prevent Excel formula corruption
        for col in ["author", "content"]:
            if col in master_df.columns:
                master_df[col] = master_df[col].fillna("").astype(str).apply(
                    lambda x: f" {x}" if x.startswith("=") else x
                )

        master_df["at"] = (
            pd.to_datetime(master_df["at"], utc=True, errors="coerce")
              .dt.tz_localize(None)
        )

        master_df["sentiment"] = master_df.apply(analyze_sentiment, axis=1)
        master_df = categorize_feedback(master_df)

        top_keywords_df = get_top_negative_keywords(master_df)

        bad_df = master_df[
            (master_df["rating"] <= 2) | (master_df["sentiment"] == "Tiêu cực")
        ].copy()

        log.info(f"Negative/Low-rating reviews: {len(bad_df)}")

        write_excel(master_df, bad_df, top_keywords_df, OUTPUT_FILE)

        print("\n" + "═" * 50)
        print(f"  TỔNG REVIEWS   : {len(master_df)}")
        print(f"  CẦN CHÚ Ý      : {len(bad_df)}")
        print(f"  TOP KEYWORDS   : {len(top_keywords_df)} từ tiêu cực")
        print("═" * 50)
        print(f"  File: {OUTPUT_FILE}")
        print("═" * 50 + "\n")