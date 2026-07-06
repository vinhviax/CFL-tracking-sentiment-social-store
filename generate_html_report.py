"""
  Crossfire Legends - HTML Report Generator from Excel
  Reads the data.ai review Excel file and produces a premium interactive HTML report.
"""

import sys
import os
import json
import logging
import re
import openpyxl
import pandas as pd
from datetime import datetime

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
log = logging.getLogger(__name__)

CATEGORY_SEVERITY_ORDER = [
    "Vấn Nạn Hack / Cheat",
    "Lỗi Văng Game / Crash",
    "Lỗi Giật Lag / Drop FPS",
    "Lỗi Kết Nối / Đăng Nhập",
    "Lỗi Ghép Trận",
    "Lỗi Cập Nhật / Đứng Tải",
    "Lỗi Âm Thanh / Hình Ảnh",
    "Lỗi Nạp Tiền / Giao Dịch",
    "Cân Bằng Gameplay"
]

def get_issue_rankings(df, store_name):
    store_df = df[(df["Store"] == store_name) & (df["sentiment"].isin(["Tiêu cực", "Hỗn hợp"]))]
    if store_df.empty:
        return []
        
    # Split and explode categories
    temp_df = store_df.copy()
    temp_df["category"] = temp_df["category"].str.split(", ")
    exploded_df = temp_df.explode("category")
    
    grouped = exploded_df.groupby(["Version Segment", "category"]).size().reset_index(name="count")
    grouped = grouped[~grouped["category"].isin(["Ý Kiến Khác / Chê Chung", "Khen"])].reset_index(drop=True)
    
    v2_name = "Version 2 (03/03 - 27/04)"
    v3_name = "Version 3 (28/04 - Present)"
    
    v2_total_neg = len(store_df[store_df["Version Segment"] == v2_name])
    v3_total_neg = len(store_df[store_df["Version Segment"] == v3_name])
    
    v2_data = grouped[grouped["Version Segment"] == v2_name].sort_values("count", ascending=False).reset_index(drop=True)
    v3_data = grouped[grouped["Version Segment"] == v3_name].sort_values("count", ascending=False).reset_index(drop=True)
    
    v2_ranks = {row["category"]: (idx + 1, int(row["count"])) for idx, row in v2_data.iterrows()}
    v3_ranks = {row["category"]: (idx + 1, int(row["count"])) for idx, row in v3_data.iterrows()}
    
    all_cats = list(set(v2_ranks.keys()).union(set(v3_ranks.keys())))
    
    comparison = []
    for cat in all_cats:
        v2_rank, v2_count = v2_ranks.get(cat, (None, 0))
        v3_rank, v3_count = v3_ranks.get(cat, (None, 0))
        
        v2_pct = (v2_count / v2_total_neg * 100) if v2_total_neg > 0 else 0.0
        v3_pct = (v3_count / v3_total_neg * 100) if v3_total_neg > 0 else 0.0
        total_count = v2_count + v3_count
        
        v2_display = f"#{v2_rank} - {v2_pct:.1f}% ({v2_count})" if v2_rank else "N/A"
        v3_display = f"#{v3_rank} - {v3_pct:.1f}% ({v3_count})" if v3_rank else "N/A"
        
        if v2_rank is not None and v3_rank is not None:
            if v3_rank < v2_rank:
                change_text = f"Tăng {v2_rank - v3_rank} bậc 🔺 (Nghiêm trọng hơn)"
                change_class = "rank-up"
            elif v3_rank > v2_rank:
                change_text = f"Giảm {v3_rank - v2_rank} bậc 🔻 (Cải thiện)"
                change_class = "rank-down"
            else:
                change_text = "Không đổi ➖"
                change_class = "rank-same"
        elif v2_rank is None:
            change_text = "Mới ở V3 🆕 (Cần lưu ý!)"
            change_class = "rank-new"
        else:
            change_text = "Biến mất ở V3 🟢 (Đã khắc phục)"
            change_class = "rank-resolved"
            
        comparison.append({
            "category": cat,
            "v2_display": v2_display,
            "v3_display": v3_display,
            "total_count": total_count,
            "change_text": change_text,
            "change_class": change_class,
            "v3_rank_num": v3_rank if v3_rank is not None else 999,
            "v2_rank_num": v2_rank if v2_rank is not None else 999,
            "v3_count": v3_count
        })
        
    comparison.sort(key=lambda x: (x["v3_rank_num"], x["v2_rank_num"]))
    return comparison

CATEGORY_TRANSLATIONS = {
    "Vấn Nạn Hack / Cheat": {"en": "Hack / Cheat Issues", "zh": "外挂/作弊问题"},
    "Lỗi Văng Game / Crash": {"en": "Crash / Game Freezing", "zh": "游戏崩溃/闪退"},
    "Lỗi Giật Lag / Drop FPS": {"en": "Lag / Drop FPS", "zh": "卡顿/掉帧"},
    "Lỗi Kết Nối / Đăng Nhập": {"en": "Connection / Login Issues", "zh": "连接/登录问题"},
    "Lỗi Ghép Trận": {"en": "Matchmaking Issues", "zh": "匹配机制问题"},
    "Lỗi Cập Nhật / Đứng Tải": {"en": "Update / Download Stuck", "zh": "更新/下载卡进度"},
    "Lỗi Âm Thanh / Hình Ảnh": {"en": "Audio / Graphic Issues", "zh": "音效/画面问题"},
    "Lỗi Nạp Tiền / Giao Dịch": {"en": "Top-up / Transaction Issues", "zh": "充值/交易问题"},
    "Cân Bằng Gameplay": {"en": "Gameplay Balance", "zh": "游戏玩法平衡"},
    "Ý Kiến Khác / Chê Chung": {"en": "Other Comments / General Criticisms", "zh": "其他意见/一般批评"},
    "Khen": {"en": "Praise", "zh": "好评"}
}

SENTIMENT_TRANSLATIONS = {
    "Tích cực": {"en": "Positive", "zh": "积极"},
    "Tiêu cực": {"en": "Negative", "zh": "消极"},
    "Hỗn hợp": {"en": "Mixed", "zh": "混合"},
    "Trung lập": {"en": "Neutral", "zh": "中立"}
}

CHANGE_TRANSLATIONS = {
    "Không đổi ➖": {"en": "Unchanged ➖", "zh": "无变化 ➖"},
    "Mới ở V3 🆕 (Cần lưu ý!)": {"en": "New in V3 🆕 (Notice!)", "zh": "第 3 版新增 🆕 (需注意！)"},
    "Biến mất ở V3 🟢 (Đã khắc phục)": {"en": "Resolved in V3 🟢 (Fixed)", "zh": "第 3 版消失 🟢 (已解决)"}
}

RECOMMENDATION_TEMPLATES_EN = {
    "Google Play": {
        "Vấn Nạn Hack / Cheat": "Need to upgrade the anti-cheat system and memory scanning security mechanism on Android to detect mod/hack software that is spreading in V3.",
        "Lỗi Văng Game / Crash": "Need to check engine crash logs on popular Android devices to resolve freezing and automatic game exit mid-match.",
        "Lỗi Giật Lag / Drop FPS": "Need to optimize FPS, compress graphic assets, and upgrade Android server ping to minimize severe lag during battles.",
        "Lỗi Kết Nối / Đăng Nhập": "Optimize connection to login server and fix login network connection issues (Facebook/Google) on Android devices.",
        "Lỗi Ghép Trận": "Adjust matchmaking algorithm to shorten search time and reduce skill gap between Android players.",
        "Lỗi Cập Nhật / Đứng Tải": "Fix 100% download freeze when installing/updating and optimize update resource download bandwidth on Android.",
        "Lỗi Âm Thanh / Hình Ảnh": "Fix audio loss, chat mic errors, and UI display glitches on Android.",
        "Lỗi Nạp Tiền / Giao Dịch": "Review Google Play payment gateway to prevent charging without delivering diamonds/items in V4.",
        "Cân Bằng Gameplay": "Optimize weapon stats, rank point system, and map bug spots when playing on Android devices."
    },
    "App Store": {
        "Vấn Nạn Hack / Cheat": "Strengthen anti-hack/mod mechanisms on iOS to clean up the competitive gaming environment.",
        "Lỗi Văng Game / Crash": "Check crash logs and optimize installation assets to minimize sudden game crashes on iOS.",
        "Lỗi Giật Lag / Drop FPS": "Focus on optimizing frame rate (FPS) and iOS server ping, especially compatibility with high refresh rate screens (120Hz).",
        "Lỗi Kết Nối / Đăng Nhập": "Fix mid-game disconnections and loading resources error when logging in on iOS devices.",
        "Lỗi Ghép Trận": "Improve matchmaking algorithm to reduce long search times for iOS players.",
        "Lỗi Cập Nhật / Đứng Tải": "Resolve resource update loading freezes and screen hang during login on iOS.",
        "Lỗi Âm Thanh / Hình Ảnh": "Fix in-game voice chat microphone and audio crackling or sudden volume loss on iOS.",
        "Lỗi Nạp Tiền / Giao Dịch": "Review top-up diamond transactions via Apple ID on iOS to avoid item delivery delay.",
        "Cân Bằng Gameplay": "Adjust balance of weapon stats, rank point calculation, and map bug spots on iOS."
    }
}

RECOMMENDATION_TEMPLATES_ZH = {
    "Google Play": {
        "Vấn Nạn Hack / Cheat": "需要升级 Android 上的反作弊系统和内存扫描安全机制，以检测第 3 版中泛滥的修改/外挂软件。",
        "Lỗi Văng Game / Crash": "需要检查主流 Android 设备上的引擎崩溃日志，解决游戏中途卡死和自动退出的问题。",
        "Lỗi Giật Lag / Drop FPS": "需要优化帧率（FPS）、压缩美术资源并升级 Android 服务器 Ping 值，以减少战斗中的严重卡顿。",
        "Lỗi Kết Nối / Đăng Nhập": "优化登录服务器连接，修复 Android 设备上社交网络（Facebook/Google）登录连接受阻的问题。",
        "Lỗi Ghép Trận": "调整匹配算法，缩短寻找对局时间，并减少 Android 玩家之间的实力差距。",
        "Lỗi Cập Nhật / Đứng Tải": "修复 Android 安装/更新时卡 100% 的问题，并优化更新资源下载带宽。",
        "Lỗi Âm Thanh / Hình Ảnh": "修复 Android 上的音频丢失、语音麦克风错误以及界面显示异常问题。",
        "Lỗi Nạp Tiền / Giao Dịch": "审查 Google Play 支付通道，避免第 4 版中出现扣款却未收到钻石/道具的错误。",
        "Cân Bằng Gameplay": "优化 Android 设备上的武器数值、排位积分机制并修复地图卡角漏洞。"
    },
    "App Store": {
        "Vấn Nạn Hack / Cheat": "加强 iOS 上的防外挂/修改机制，以净化游戏竞技环境。",
        "Lỗi Văng Game / Crash": "检查崩溃日志并优化安装包资源，以减少 iOS 上的突然闪退。",
        "Lỗi Giật Lag / Drop FPS": "专注于优化帧率（FPS）和 iOS 服务器 Ping 值，特别是高刷新率屏幕（120Hz）的兼容性。",
        "Lỗi Kết Nối / Đăng Nhập": "修复 iOS 设备上游戏中途断开连接以及首次登录时加载资源卡死的问题。",
        "Lỗi Ghép Trận": "改进匹配算法，减少 iOS 玩家寻找对局排队时间过长的问题。",
        "Lỗi Cập Nhật / Đứng Tải": "解决 iOS 上更新资源包下载卡死和登录时画面挂起的问题。",
        "Lỗi Âm Thanh / Hình Ảnh": "修复 iOS 设备上的语音通话麦克风故障以及游戏声音沙哑或突然静音的问题。",
        "Lỗi Nạp Tiền / Giao Dịch": "审查 iOS 上通过 Apple ID 充值钻石的交易流程，避免道具发放延迟。",
        "Cân Bằng Gameplay": "调整 iOS 上的枪械平衡参数、排位加减分机制并修复地图 lag 漏洞。"
    }
}

def translate_change_text(text, lang):
    if not text:
        return ""
    if lang == "vi":
        return text
    if text in CHANGE_TRANSLATIONS:
        return CHANGE_TRANSLATIONS[text][lang]
    # Check for "Tăng {n} bậc 🔺 (Nghiêm trọng hơn)"
    m_up = re.match(r"Tăng (\d+) bậc 🔺 \(Nghiêm trọng hơn\)", text)
    if m_up:
        n = m_up.group(1)
        if lang == "en":
            return f"Up {n} rank(s) 🔺 (More severe)"
        elif lang == "zh":
            return f"上升 {n} 位 🔺 (更为严重)"
    # Check for "Giảm {n} bậc 🔻 (Cải thiện)"
    m_down = re.match(r"Giảm (\d+) bậc 🔻 \(Cải thiện\)", text)
    if m_down:
        n = m_down.group(1)
        if lang == "en":
            return f"Down {n} rank(s) 🔻 (Improved)"
        elif lang == "zh":
            return f"下降 {n} 位 🔻 (有所改善)"
    return text

def translate_analysis_text(text, lang):
    if not text:
        return ""
    if lang == "vi":
        return text
        
    lines = text.split("\n")
    translated_lines = []
    
    for line in lines:
        line_strip = line.strip()
        if not line_strip:
            continue
            
        is_bullet = line_strip.startswith("•") or line_strip.startswith("-")
        content = line_strip[1:].strip() if is_bullet else line_strip
        
        translated_content = content
        
        # 1. Platform Review Analysis
        m1 = re.match(r"Phân tích đánh giá trên (Google Play|App Store):", content)
        if m1:
            store = m1.group(1)
            if lang == "en":
                translated_content = f"{store} Review Analysis:"
            elif lang == "zh":
                translated_content = f"{store} 评论分析："
                
        # 2. Data scale
        m2 = re.match(r"Quy mô dữ liệu: Version 2 ghi nhận (\d+) đánh giá, trong khi Version 3 ghi nhận (\d+) đánh giá\.", content)
        if m2:
            v2, v3 = m2.group(1), m2.group(2)
            if lang == "en":
                translated_content = f"Data scale: Version 2 recorded {v2} reviews, while Version 3 recorded {v3} reviews."
            elif lang == "zh":
                translated_content = f"数据规模：第 2 版录得 {v2} 条评论，而第 3 版录得 {v3} 条评论。"
                
        # 3. Rating trend - increase
        m3 = re.match(r"Xu hướng điểm số: Điểm đánh giá trung bình tăng từ ([\d\.]+) \(V2\) lên ([\d\.]+) \(V3\), cho thấy tín hiệu cải thiện tích cực về mức độ hài lòng chung của người chơi\.", content)
        if m3:
            v2, v3 = m3.group(1), m3.group(2)
            if lang == "en":
                translated_content = f"Rating trend: The average rating increased from {v2} (V2) to {v3} (V3), indicating positive signs of improvement in overall player satisfaction."
            elif lang == "zh":
                translated_content = f"评分趋势：平均评分从 {v2}（V2）上升至 {v3}（V3），显示出玩家整体满意度改善的积极信号。"
                
        # 4. Rating trend - decrease
        m4 = re.match(r"Xu hướng điểm số: Điểm đánh giá trung bình bị giảm sút đáng kể từ ([\d\.]+) \(V2\) xuống còn ([\d\.]+) \(V3\)\. Điều này cảnh báo phiên bản mới đang phát sinh thêm lỗi gây khó chịu cho người dùng\.", content)
        if m4:
            v2, v3 = m4.group(1), m4.group(2)
            if lang == "en":
                translated_content = f"Rating trend: The average rating decreased significantly from {v2} (V2) to {v3} (V3). This warns that the new version is causing additional bugs that annoy users."
            elif lang == "zh":
                translated_content = f"评分趋势：平均评分从 {v2}（V2）显著下降至 {v3}（V3）。这警告新版本正产生更多让用户反感的错误。"
                
        # 5. Rating trend - stable
        m5 = re.match(r"Xu hướng điểm số: Điểm đánh giá trung bình giữ mức ổn định từ ([\d\.]+) \(V2\) sang ([\d\.]+) \(V3\) \(chênh lệch ([\d\.\-]+)\)\.", content)
        if m5:
            v2, v3, diff = m5.group(1), m5.group(2), m5.group(3)
            if lang == "en":
                translated_content = f"Rating trend: The average rating remained stable from {v2} (V2) to {v3} (V3) (difference of {diff})."
            elif lang == "zh":
                translated_content = f"评分趋势：平均评分从 {v2}（V2）到 {v3}（V3）保持稳定（差异为 {diff}）。"
                
        # 6. Negative ratio - increase
        m6 = re.match(r"Tỷ lệ tiêu cực: Tỷ lệ phản hồi tiêu cực tăng thêm ([\d\.]+)% ở Version 3 \(từ ([\d\.]+)% lên ([\d\.]+)%\), chứng tỏ phiên bản mới cần được tối ưu hóa kỹ lưỡng hơn\.", content)
        if m6:
            diff, v2, v3 = m6.group(1), m6.group(2), m6.group(3)
            if lang == "en":
                translated_content = f"Negative ratio: The negative feedback ratio increased by {diff}% in Version 3 (from {v2}% to {v3}%), showing that the new version needs to be optimized more carefully."
            elif lang == "zh":
                translated_content = f"差评比例：第 3 版的差评反馈比例增加了 {diff}%（从 {v2}% 上升至 {v3}%），表明新版本需要更仔细地优化。"
                
        # 7. Negative ratio - decrease
        m7 = re.match(r"Tỷ lệ tiêu cực: Tỷ lệ phản hồi tiêu cực giảm rõ rệt ([\d\.]+)% ở Version 3 \(từ ([\d\.]+)% xuống ([\d\.]+)%\), cho thấy những nỗ lực cập nhật/vá lỗi đã phát huy tác dụng\.", content)
        if m7:
            diff, v2, v3 = m7.group(1), m7.group(2), m7.group(3)
            if lang == "en":
                translated_content = f"Negative ratio: The negative feedback ratio decreased significantly by {diff}% in Version 3 (from {v2}% to {v3}%), showing that update/bug fix efforts have taken effect."
            elif lang == "zh":
                translated_content = f"差评比例：第 3 版的差评反馈比例明显下降了 {diff}%（从 {v2}% 降至 {v3}%），表明更新和修复工作已取得成效。"
                
        # 8. Negative ratio - stable
        m8 = re.match(r"Tỷ lệ tiêu cực: Tỷ lệ tiêu cực biến động nhẹ \(V2: ([\d\.]+)% so với V3: ([\d\.]+)%\)\.", content)
        if m8:
            v2, v3 = m8.group(1), m8.group(2)
            if lang == "en":
                translated_content = f"Negative ratio: The negative ratio fluctuated slightly (V2: {v2}% compared to V3: {v3}%)."
            elif lang == "zh":
                translated_content = f"差评比例：差评比例波动较小（V2：{v2}% 对比 V3：{v3}%）。"
                
        # 9. Core issue
        m9 = re.match(r"Vấn đề cốt lõi: Nhóm '([^']+)' tiếp tục là vấn đề nghiêm trọng nhất ở cả 2 phiên bản\. Đây là điểm nghẽn trải nghiệm chưa được giải quyết triệt để\.", content)
        if m9:
            issue = m9.group(1)
            issue_trans = CATEGORY_TRANSLATIONS.get(issue, {"en": issue, "zh": issue})
            if lang == "en":
                translated_content = f"Core issue: The '{issue_trans['en']}' group remains the most severe problem across both versions. This is an experience bottleneck that has not been completely resolved."
            elif lang == "zh":
                translated_content = f"核心问题：'{issue_trans['zh']}' 类别在两个版本中仍是最严重的问题。这是尚未彻底解决 of 体验瓶颈。"
                
        # 10. Core issue - none
        m10 = re.match(r"Vấn đề cốt lõi: Không ghi nhận vấn đề kỹ thuật đặc thù nào quá nổi trội\.", content)
        if m10:
            if lang == "en":
                translated_content = "Core issue: No specific technical issues were particularly prominent."
            elif lang == "zh":
                translated_content = "核心问题：未记录任何特别突出的特定技术问题。"
                
        # 11. Focus shift
        m11 = re.match(r"Sự thay đổi lỗi trọng tâm: Ở Version 2, vấn đề nổi cộm nhất là '([^']*)', nhưng sang Version 3 đã chuyển dịch sang '([^']*)'\. Vận hành cần tập trung xử lý ngay vấn đề mới phát sinh này\.", content)
        if m11:
            v2, v3 = m11.group(1), m11.group(2)
            v2_trans = CATEGORY_TRANSLATIONS.get(v2, {"en": v2, "zh": v2})
            v3_trans = CATEGORY_TRANSLATIONS.get(v3, {"en": v3, "zh": v3})
            if lang == "en":
                translated_content = f"Focus shift: In Version 2, the most prominent issue was '{v2_trans['en']}', but in Version 3 it shifted to '{v3_trans['en']}'. Operations need to focus on resolving this newly emerged issue immediately."
            elif lang == "zh":
                translated_content = f"焦点转移：在第 2 版中，最突出的问题是 '{v2_trans['zh']}'，但在第 3 版中转移到了 '{v3_trans['zh']}'。运营团队需要立即专注于解决这一新出现的问题。"

        # If a bullet was present, prepend it back
        if is_bullet:
            translated_lines.append(f"• {translated_content}")
        else:
            translated_lines.append(translated_content)
            
    return "\n".join(translated_lines)

def generate_recommendations_lang(gp_ranks, as_ranks, lang):
    gp_v3 = sorted([r for r in gp_ranks if r["v3_count"] > 0], key=lambda x: x["v3_rank_num"])
    as_v3 = sorted([r for r in as_ranks if r["v3_count"] > 0], key=lambda x: x["v3_rank_num"])
    
    RECOMMENDATION_TEMPLATES = {
        "vi": {
            "Google Play": {
                "Vấn Nạn Hack / Cheat": "Cần nâng cấp hệ thống Anti-cheat và cơ chế bảo mật quét bộ nhớ trên Android để phát hiện các phần mềm mod/hack đang tràn lan ở bản V3.",
                "Lỗi Văng Game / Crash": "Cần kiểm tra log crash của engine trên các dòng máy Android phổ thông để khắc phục hiện tượng đứng máy, tự động thoát game giữa trận.",
                "Lỗi Giật Lag / Drop FPS": "Cần tối ưu hóa FPS, nén dung lượng đồ họa và nâng cấp ping máy chủ Android để giảm thiểu tình trạng giật lag nghiêm trọng khi giao tranh.",
                "Lỗi Kết Nối / Đăng Nhập": "Tối ưu hóa kết nối đến máy chủ đăng nhập và sửa lỗi kẹt kết nối mạng xã hội (Facebook/Google) trên thiết bị Android.",
                "Lỗi Ghép Trận": "Điều chỉnh thuật toán ghép đội (matchmaking) để rút ngắn thời gian tìm trận và giảm chênh lệch trình độ giữa người chơi Android.",
                "Lỗi Cập Nhật / Đứng Tải": "Sửa lỗi kẹt tải tài nguyên 100% khi cài đặt/cập nhật game và tối ưu hóa băng thông tải dữ liệu trên Android.",
                "Lỗi Âm Thanh / Hình Ảnh": "Khắc phục lỗi mất âm thanh game, lỗi mic chat và các vấn đề hiển thị hình ảnh lỏ, lỗi giao diện trên Android.",
                "Lỗi Nạp Tiền / Giao Dịch": "Rà soát lại cổng thanh toán Google Play để tránh lỗi trừ tiền nhưng không nhận được kim cương/vật phẩm ở bản V4.",
                "Cân Bằng Gameplay": "Tối ưu lại thông số vũ khí, cơ chế điểm rank và vá lỗi kẹt góc bản đồ (bug map) khi chơi trên thiết bị Android."
            },
            "App Store": {
                "Vấn Nạn Hack / Cheat": "Tăng cường cơ chế chống hack/mod trên iOS để làm sạch môi trường thi đấu game.",
                "Lỗi Văng Game / Crash": "Kiểm tra log crash và tối ưu hóa tài nguyên cài đặt nhằm giảm thiểu văng game đột ngột trên iOS.",
                "Lỗi Giật Lag / Drop FPS": "Tập trung tối ưu hóa khung hình (FPS) và ping máy chủ iOS, đặc biệt tương thích màn hình tần số quét cao (120Hz).",
                "Lỗi Kết Nối / Đăng Nhập": "Sửa lỗi mất kết nối giữa trận và lỗi tải tài nguyên khi bắt đầu đăng nhập game trên thiết bị iOS.",
                "Lỗi Ghép Trận": "Cải thiện thuật toán ghép trận để giảm thời gian hàng chờ tìm trận lâu cho người chơi trên iOS.",
                "Lỗi Cập Nhật / Đứng Tải": "Khắc phục tình trạng đứng tải gói tài nguyên cập nhật và treo màn hình khi đăng nhập trên iOS.",
                "Lỗi Âm Thanh / Hình Ảnh": "Sửa lỗi micro chat đàm thoại và lỗi tiếng game bị rè hoặc mất tiếng đột ngột trên thiết bị iOS.",
                "Lỗi Nạp Tiền / Giao Dịch": "Rà soát lại luồng giao dịch nạp kim cương qua Apple ID trên iOS để tránh lỗi chậm chuyển vật phẩm.",
                "Cân Bằng Gameplay": "Điều chỉnh cân bằng chỉ số súng đạn, điểm cộng trừ rank và vá các bug góc lag map trên iOS."
            }
        },
        "en": RECOMMENDATION_TEMPLATES_EN,
        "zh": RECOMMENDATION_TEMPLATES_ZH
    }
    
    headers = {
        "vi": {
            "title": "Báo cáo phân tích chuyên sâu lỗi theo Nền tảng & Định hướng phát triển cho Phiên bản mới (Version 4+):",
            "gp": "🤖 NỀN TẢNG GOOGLE PLAY (ANDROID):",
            "as": "🍎 NỀN TẢNG APP STORE (IOS):",
            "roadmap": "🚀 ĐỊNH HƯỚNG ƯU TIÊN SỬA LỖI CHO PHIÊN BẢN VERSION 4+ (ROADMAP):",
            "gp_empty": "Không ghi nhận lỗi tiêu cực đáng kể nào trên Google Play ở V3.",
            "as_empty": "Không ghi nhận lỗi tiêu cực đáng kể nào trên App Store ở V3."
        },
        "en": {
            "title": "In-depth issue analysis by Platform & Development direction for the new version (Version 4+):",
            "gp": "🤖 GOOGLE PLAY PLATFORM (ANDROID):",
            "as": "🍎 APP STORE PLATFORM (IOS):",
            "roadmap": "🚀 BUG FIX PRIORITIES & ROADMAP FOR VERSION 4+:",
            "gp_empty": "No significant negative reviews recorded on Google Play in V3.",
            "as_empty": "No significant negative reviews recorded on App Store in V3."
        },
        "zh": {
            "title": "按平台进行的问题深度分析及新版本（第 4 版+）的发展方向：",
            "gp": "🤖 GOOGLE PLAY 平台 (ANDROID)：",
            "as": "🍎 APP STORE 平台 (IOS)：",
            "roadmap": "🚀 第 4 版+ 优先修复问题方向（路线图）：",
            "gp_empty": "第 3 版中 Google Play 未记录显著的消极评论。",
            "as_empty": "第 3 版中 App Store 未记录显著的消极评论。"
        }
    }
    
    html = []
    html.append(f"<p style='font-size: 1.05rem; font-weight: 700; margin-bottom: 12px;'>{headers[lang]['title']}</p>")
    
    # Platform 1: Google Play
    html.append(f"<p style='font-weight: 700; color: var(--gp-color); margin-top: 15px; margin-bottom: 8px;'>{headers[lang]['gp']}</p>")
    gp_list = []
    if gp_v3:
        cat0 = gp_v3[0]['category']
        cat0_trans = CATEGORY_TRANSLATIONS.get(cat0, {"en": cat0, "zh": cat0})
        cat0_display = cat0_trans[lang] if lang != "vi" else cat0
        advice0 = RECOMMENDATION_TEMPLATES[lang]["Google Play"].get(cat0, "Cần theo dõi sát sao phản hồi của người dùng để khắc phục lỗi.")
        
        if lang == "vi":
            gp_list.append(f"<li><strong>Ưu tiên 1 - {cat0}:</strong> Đang là vấn đề nghiêm trọng nhất ở V3 ({gp_v3[0]['v3_count']} reviews). {advice0}</li>")
        elif lang == "en":
            gp_list.append(f"<li><strong>Priority 1 - {cat0_display}:</strong> Most severe issue in V3 ({gp_v3[0]['v3_count']} reviews). {advice0}</li>")
        elif lang == "zh":
            gp_list.append(f"<li><strong>优先级 1 - {cat0_display}：</strong> 第 3 版中最严重的问题（{gp_v3[0]['v3_count']} 条评论）。{advice0}</li>")
        
        if len(gp_v3) > 1:
            cat1 = gp_v3[1]['category']
            cat1_trans = CATEGORY_TRANSLATIONS.get(cat1, {"en": cat1, "zh": cat1})
            cat1_display = cat1_trans[lang] if lang != "vi" else cat1
            advice1 = RECOMMENDATION_TEMPLATES[lang]["Google Play"].get(cat1, "Cần theo dõi phản hồi của người dùng để khắc phục lỗi.")
            
            if lang == "vi":
                gp_list.append(f"<li><strong>Ưu tiên 2 - {cat1}:</strong> Xếp thứ hai về độ nghiêm trọng ({gp_v3[1]['v3_count']} reviews). {advice1}</li>")
            elif lang == "en":
                gp_list.append(f"<li><strong>Priority 2 - {cat1_display}:</strong> Second in severity ({gp_v3[1]['v3_count']} reviews). {advice1}</li>")
            elif lang == "zh":
                gp_list.append(f"<li><strong>优先级 2 - {cat1_display}：</strong> 严重程度排第二（{gp_v3[1]['v3_count']} 条评论）。{advice1}</li>")
        
        # Check if Monetization rose in rank or exists
        mone_gp = [r for r in gp_v3 if r["category"] == "Lỗi Nạp Tiền / Giao Dịch"]
        if mone_gp:
            advice_mone = RECOMMENDATION_TEMPLATES[lang]["Google Play"].get("Lỗi Nạp Tiền / Giao Dịch", "")
            if lang == "vi":
                gp_list.append(f"<li><strong>Đáng chú ý - Nạp tiền / Giao dịch:</strong> Ghi nhận {mone_gp[0]['v3_count']} reviews tiêu cực ở V3. {advice_mone}</li>")
            elif lang == "en":
                gp_list.append(f"<li><strong>Notable - Top-up / Transactions:</strong> Recorded {mone_gp[0]['v3_count']} negative reviews in V3. {advice_mone}</li>")
            elif lang == "zh":
                gp_list.append(f"<li><strong>值得注意 - 充值/交易：</strong> 第 3 版中记录了 {mone_gp[0]['v3_count']} 条消极评论。{advice_mone}</li>")
    else:
        gp_list.append(f"<li>{headers[lang]['gp_empty']}</li>")
    html.append(f"<ul class='analysis-list'>{''.join(gp_list)}</ul>")
    
    # Platform 2: App Store
    html.append(f"<p style='font-weight: 700; color: var(--as-color); margin-top: 15px; margin-bottom: 8px;'>{headers[lang]['as']}</p>")
    as_list = []
    if as_v3:
        cat0 = as_v3[0]['category']
        cat0_trans = CATEGORY_TRANSLATIONS.get(cat0, {"en": cat0, "zh": cat0})
        cat0_display = cat0_trans[lang] if lang != "vi" else cat0
        advice0 = RECOMMENDATION_TEMPLATES[lang]["App Store"].get(cat0, "Cần theo dõi sát sao phản hồi của người dùng để khắc phục lỗi.")
        
        if lang == "vi":
            as_list.append(f"<li><strong>Ưu tiên 1 - {cat0}:</strong> Ghi nhận lượng phàn nàn nhiều nhất ở V3 ({as_v3[0]['v3_count']} reviews). {advice0}</li>")
        elif lang == "en":
            as_list.append(f"<li><strong>Priority 1 - {cat0_display}:</strong> Received the most complaints in V3 ({as_v3[0]['v3_count']} reviews). {advice0}</li>")
        elif lang == "zh":
            as_list.append(f"<li><strong>优先级 1 - {cat0_display}：</strong> 第 3 版中收到最多投诉（{as_v3[0]['v3_count']} 条评论）。{advice0}</li>")
        
        if len(as_v3) > 1:
            cat1 = as_v3[1]['category']
            cat1_trans = CATEGORY_TRANSLATIONS.get(cat1, {"en": cat1, "zh": cat1})
            cat1_display = cat1_trans[lang] if lang != "vi" else cat1
            advice1 = RECOMMENDATION_TEMPLATES[lang]["App Store"].get(cat1, "Cần theo dõi phản hồi của người dùng để khắc phục lỗi.")
            
            if lang == "vi":
                as_list.append(f"<li><strong>Ưu tiên 2 - {cat1}:</strong> Đứng thứ hai về số lượng ({as_v3[1]['v3_count']} reviews). {advice1}</li>")
            elif lang == "en":
                as_list.append(f"<li><strong>Priority 2 - {cat1_display}:</strong> Second in volume ({as_v3[1]['v3_count']} reviews). {advice1}</li>")
            elif lang == "zh":
                as_list.append(f"<li><strong>优先级 2 - {cat1_display}：</strong> 数量排第二（{as_v3[1]['v3_count']} 条评论）。{advice1}</li>")
            
        if len(as_v3) > 2:
            cat2 = as_v3[2]['category']
            cat2_trans = CATEGORY_TRANSLATIONS.get(cat2, {"en": cat2, "zh": cat2})
            cat2_display = cat2_trans[lang] if lang != "vi" else cat2
            advice2 = RECOMMENDATION_TEMPLATES[lang]["App Store"].get(cat2, "Cần theo dõi phản hồi của người dùng để khắc phục lỗi.")
            
            if lang == "vi":
                as_list.append(f"<li><strong>Ưu tiên 3 - {cat2}:</strong> Chiếm {as_v3[2]['v3_count']} reviews tiêu cực ở V3. {advice2}</li>")
            elif lang == "en":
                as_list.append(f"<li><strong>Priority 3 - {cat2_display}:</strong> Accounting for {as_v3[2]['v3_count']} negative reviews in V3. {advice2}</li>")
            elif lang == "zh":
                as_list.append(f"<li><strong>优先级 3 - {cat2_display}：</strong> 第 3 版中占 {as_v3[2]['v3_count']} 条消极评论。{advice2}</li>")
    else:
        as_list.append(f"<li>{headers[lang]['as_empty']}</li>")
    html.append(f"<ul class='analysis-list'>{''.join(as_list)}</ul>")
    
    # Strategy for V4+
    html.append(f"<p style='font-weight: 700; color: var(--accent-color); margin-top: 20px; margin-bottom: 8px;'>{headers[lang]['roadmap']}</p>")
    
    roadmap = {
        "vi": [
            "<strong>[HOTFIX KHẨN CẤP] Trọng tâm Lỗi Văng Game / Crash trên cả hai nền tảng:</strong> Đây là lỗi nghiêm trọng nhất làm giảm rating và gây rụng người chơi (drop game). Studio cần ưu tiên tài nguyên kỹ thuật 70% để sửa lỗi này trước tiên.",
            "<strong>[TỐI ƯU HIỆU NĂNG] Giảm giật lag (Lỗi Giật Lag / Drop FPS):</strong> Tập trung tối ưu hóa tài nguyên nén đồ họa và ping máy chủ, đặc biệt cho các dòng máy tầm trung và thấp chiếm số đông người dùng.",
            "<strong>[CỘNG ĐỒNG] Chiến dịch bài trừ gian lận:</strong> Tăng cường anti-cheat và đăng Ban-list hàng tuần để xoa dịu làn sóng phẫn nộ về hack/cheat trên cả Android và iOS."
        ],
        "en": [
            "<strong>[URGENT HOTFIX] Focus on Crash / Freezing issues on both platforms:</strong> This is the most severe bug causing rating drop and player churn. The studio needs to allocate 70% of engineering resources to prioritize fixing this first.",
            "<strong>[PERFORMANCE OPTIMIZATION] Reduce lag (Lag / Drop FPS):</strong> Focus on graphics assets compression and server ping, especially for low and mid-tier devices that represent the majority of users.",
            "<strong>[COMMUNITY] Anti-cheat Campaign:</strong> Strengthen anti-cheat systems and publish weekly ban lists to appease the outrage regarding hack/cheating on both Android and iOS."
        ],
        "zh": [
            "<strong>【紧急热修复】双平台的核心问题在于崩溃/闪退：</strong> 这是降低评分和导致玩家流失的最严重问题。工作室需要优先分配 70% 的技术资源来修复此项。",
            "<strong>【性能优化】降低卡顿（卡顿/掉帧）：</strong> 专注于优化美术资源压缩和服务器 Ping 值，特别是占大多数用户群体的中低端机型。",
            "<strong>【社区运营】反作弊专项行动：</strong> 强化防作弊系统并每周公布封禁名单，以平息双平台玩家对作弊行为的愤慨。"
        ]
    }
    
    html.append(f"<ul class='analysis-list'>{''.join(f'<li>{step}</li>' for step in roadmap[lang])}</ul>")
    
    return "".join(html)

def format_text_to_html(text):
    if not text:
        return ""
    # Standardize linebreaks
    formatted = text.replace("\\n", "\n").replace("\n", "<br>")
    lines = formatted.split("<br>")
    html_lines = []
    for line in lines:
        line_strip = line.strip()
        if not line_strip:
            continue
        if line_strip.startswith("•") or line_strip.startswith("-"):
            html_lines.append(f"<li>{line_strip[1:].strip()}</li>")
        elif any(line_strip.startswith(f"{i}.") for i in range(1, 10)):
            # Keep numbers in lists
            html_lines.append(f"<li>{line_strip}</li>")
        else:
            html_lines.append(f"<p>{line_strip}</p>")
            
    final_html = ""
    in_list = False
    for item in html_lines:
        if item.startswith("<li>"):
            if not in_list:
                final_html += "<ul class='analysis-list'>"
                in_list = True
            final_html += item
        else:
            if in_list:
                final_html += "</ul>"
                in_list = False
            final_html += item
    if in_list:
        final_html += "</ul>"
    return final_html

def extract_comparison_table(ws, start_row):
    data = []
    for row in range(start_row + 1, start_row + 6):
        metric = ws.cell(row=row, column=1).value
        v2_val = ws.cell(row=row, column=2).value
        v3_val = ws.cell(row=row, column=3).value
        data.append({
            "metric": metric,
            "v2": v2_val,
            "v3": v3_val
        })
    return data
def main():
    import glob
    excel_path = None
    if len(sys.argv) > 1:
        excel_path = sys.argv[1]
        
    if not excel_path:
        # Find the latest Sensor Tower or DataAI Excel report in current directory
        reports = glob.glob("Crossfire_Legends_SensorTower_VN_Report_*.xlsx")
        if not reports:
            reports = glob.glob("Crossfire_Legends_DataAI_VN_Report_*.xlsx")
        if reports:
            reports.sort(key=os.path.getmtime)
            excel_path = reports[-1]
            log.info(f"Auto-detected latest report: {excel_path}")
        else:
            excel_path = "Crossfire_Legends_SensorTower_VN_Report.xlsx"
            
    if not os.path.exists(excel_path):
        log.error(f"Excel file not found at: {excel_path}")
        sys.exit(1)
        
    log.info(f"Reading data from: {excel_path}")
    
    # 1. Parse using openpyxl for overview texts
    wb = openpyxl.load_workbook(excel_path)
    if "Overview_&_Assessment" not in wb.sheetnames:
        log.error("Sheet 'Overview_&_Assessment' missing from the Excel report!")
        sys.exit(1)
        
    ws_ov = wb["Overview_&_Assessment"]
    
    # Extract Texts
    gp_text_raw = ws_ov["A13"].value or ""
    as_text_raw = ws_ov["A26"].value or ""
    rec_text_raw = ws_ov["A31"].value or ""
    
    gp_text_html_vi = format_text_to_html(gp_text_raw)
    gp_text_html_en = format_text_to_html(translate_analysis_text(gp_text_raw, "en"))
    gp_text_html_zh = format_text_to_html(translate_analysis_text(gp_text_raw, "zh"))
    as_text_html_vi = format_text_to_html(as_text_raw)
    as_text_html_en = format_text_to_html(translate_analysis_text(as_text_raw, "en"))
    as_text_html_zh = format_text_to_html(translate_analysis_text(as_text_raw, "zh"))
    
    # Extract Comparison Tables
    gp_table = extract_comparison_table(ws_ov, 5)
    as_table = extract_comparison_table(ws_ov, 18)
    
    # 2. Parse using pandas for raw data
    df_raw = pd.read_excel(excel_path, sheet_name="Raw_Data_VN")
    
    # Clean datetime
    df_raw["at"] = pd.to_datetime(df_raw["at"]).dt.strftime("%Y-%m-%d")
    
    # Calculate general stats
    total_reviews = len(df_raw)
    avg_rating = float(df_raw["rating"].mean())
    neg_reviews = len(df_raw[df_raw["sentiment"].isin(["Tiêu cực", "Hỗn hợp"])])
    neg_ratio_pct = (neg_reviews / total_reviews * 100) if total_reviews > 0 else 0
    
    # Version 3 Top Issue (Exploding category column)
    v3_df = df_raw[df_raw["Version Segment"].str.contains("Version 3", na=False)]
    v3_neg = v3_df[v3_df["sentiment"].isin(["Tiêu cực", "Hỗn hợp"])]
    if not v3_neg.empty:
        temp_v3 = v3_neg.copy()
        temp_v3["category"] = temp_v3["category"].str.split(", ")
        exploded_v3 = temp_v3.explode("category")
        v3_cats = exploded_v3["category"].value_counts().drop("Ý Kiến Khác / Chê Chung", errors="ignore")
        top_v3_issue = v3_cats.index[0] if not v3_cats.empty else "Không có"
    else:
        top_v3_issue = "Không có"
        
    # Prepare charts data
    # 2.1 Rating Distribution: Store -> Rating (1..5) -> Count
    rating_dist = df_raw.groupby(["Store", "rating"]).size().unstack(fill_value=0).to_dict(orient="index")
    # Make sure all ratings 1..5 exist
    for store in ["Google Play", "App Store"]:
        if store not in rating_dist:
            rating_dist[store] = {1:0, 2:0, 3:0, 4:0, 5:0}
        else:
            for r in range(1, 6):
                if r not in rating_dist[store]:
                    rating_dist[store][r] = 0
                    
    # 2.2 Sentiment Distribution: Grouped by Store (ALL, Google Play, App Store) -> Segment -> Sentiment -> Count
    segments = ["Version 2 (03/03 - 27/04)", "Version 3 (28/04 - Present)"]
    sentiments = ["Tích cực", "Tiêu cực", "Hỗn hợp", "Trung lập"]
    sentiment_data = {}
    for key, sub_df in [("ALL", df_raw), ("Google Play", df_raw[df_raw["Store"] == "Google Play"]), ("App Store", df_raw[df_raw["Store"] == "App Store"])]:
        sentiment_data[key] = {}
        if sub_df.empty:
            for seg in segments:
                sentiment_data[key][seg] = {sent: 0 for sent in sentiments}
            continue
            
        grouped = sub_df.groupby(["Version Segment", "sentiment"]).size().unstack(fill_value=0).to_dict(orient="index")
        for seg in segments:
            sentiment_data[key][seg] = {}
            for sent in sentiments:
                val = 0
                if seg in grouped and sent in grouped[seg]:
                    val = int(grouped[seg][sent])
                sentiment_data[key][seg][sent] = val
    sentiment_dist = sentiment_data
                    
    # 2.3 Issues Distribution: Segment -> Category -> Count (Exploded)
    issues_df = df_raw[df_raw["sentiment"].isin(["Tiêu cực", "Hỗn hợp"])].copy()
    issues_df["category"] = issues_df["category"].str.split(", ")
    exploded_issues = issues_df.explode("category")
    issues_dist = exploded_issues.groupby(["Version Segment", "category"]).size().unstack(fill_value=0).to_dict(orient="index")
    for seg in segments:
        if seg not in issues_dist:
            issues_dist[seg] = {}
            
    # Calculate rankings of issues
    gp_ranks = get_issue_rankings(df_raw, "Google Play")
    as_ranks = get_issue_rankings(df_raw, "App Store")
    recommendations_html_vi = generate_recommendations_lang(gp_ranks, as_ranks, "vi")
    recommendations_html_en = generate_recommendations_lang(gp_ranks, as_ranks, "en")
    recommendations_html_zh = generate_recommendations_lang(gp_ranks, as_ranks, "zh")
            
    # Count of each category in df_raw for dropdown option counts
    cat_counts = {}
    temp_cats = df_raw["category"].fillna("").astype(str).str.split(", ")
    exploded_cats = temp_cats.explode()
    for cat, count in exploded_cats.value_counts().items():
        if cat.strip():
            cat_counts[cat.strip()] = count
            
    category_options = []
    category_options.append(f'<option value="all" data-count="{len(df_raw)}">Tất cả ({len(df_raw)})</option>')
    for cat in CATEGORY_SEVERITY_ORDER + ["Ý Kiến Khác / Chê Chung", "Khen"]:
        count = cat_counts.get(cat, 0)
        category_options.append(f'<option value="{cat}" data-count="{count}">{cat} ({count})</option>')
        
    category_options_html = "\n".join(category_options)

    # Serialize reviews list for interactive Explorer (only columns we need to save space)
    explorer_cols = ["author", "rating", "content", "at", "Version Segment", "Store", "sentiment", "category"]
    reviews_json_list = df_raw[explorer_cols].fillna("").to_dict(orient="records")
    
    # HTML Output path
    output_html_path = excel_path.replace(".xlsx", ".html")
    
    # HTML template content
    html_content = f"""<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title data-i18n="page_title">Báo Cáo Trải Nghiệm Người Dùng Crossfire Legends VN</title>
  
  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:ital,wght@0,300;0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
  
  <!-- Chart.js CDN -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>

  <style>
    :root {{
      --bg-primary: #f8fafc;
      --bg-secondary: #ffffff;
      --bg-tertiary: #f1f5f9;
      --text-primary: #0f172a;
      --text-secondary: #475569;
      --border-color: #e2e8f0;
      
      --primary-color: #1e3a8a;
      --primary-light: #eff6ff;
      --primary-text: #1e40af;
      
      --gp-color: #0f9d58;
      --gp-light: #e6f4ea;
      
      --as-color: #8e44ad;
      --as-light: #f5eef8;
      
      --accent-color: #c0392b;
      --accent-light: #fdedec;
      --accent-text: #922b21;
      
      --sentiment-pos: #2ecc71;
      --sentiment-neg: #e74c3c;
      --sentiment-mix: #f1c40f;
      --sentiment-neu: #95a5a6;
      
      --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05);
      --transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }}

    body.dark {{
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --bg-tertiary: #334155;
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --border-color: #334155;
      
      --primary-color: #3b82f6;
      --primary-light: #172554;
      --primary-text: #93c5fd;
      
      --gp-color: #34a853;
      --gp-light: #064e3b;
      
      --as-color: #a855f7;
      --as-light: #3b0764;
      
      --accent-color: #f43f5e;
      --accent-light: #4c0519;
      --accent-text: #fda4af;
      
      --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.3);
    }}

    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}

    body {{
      font-family: 'Be Vietnam Pro', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      transition: var(--transition);
      line-height: 1.6;
      padding-bottom: 60px;
    }}

    header {{
      background-color: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      padding: 20px 40px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: var(--shadow);
      transition: var(--transition);
    }}

    .header-title h1 {{
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--primary-color);
      margin-bottom: 4px;
    }}

    .header-title p {{
      font-size: 0.85rem;
      color: var(--text-secondary);
    }}

    .header-controls {{
      display: flex;
      align-items: center;
      gap: 15px;
    }}

    .lang-selector {{
      display: flex;
      background-color: var(--bg-tertiary);
      padding: 4px;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      gap: 2px;
    }}

    .lang-btn {{
      background: transparent;
      border: none;
      color: var(--text-secondary);
      padding: 6px 12px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.85rem;
      transition: var(--transition);
    }}

    .lang-btn:hover {{
      color: var(--text-primary);
    }}

    .lang-btn.active {{
      background-color: var(--bg-secondary);
      color: var(--primary-color);
      box-shadow: var(--shadow);
    }}

    body.dark .lang-btn.active {{
      color: var(--primary-color);
    }}

    .theme-toggle-btn {{
      background-color: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 10px 18px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: var(--transition);
    }}

    .theme-toggle-btn:hover {{
      opacity: 0.9;
      transform: translateY(-1px);
    }}

    .container {{
      max-width: 1400px;
      margin: 30px auto;
      padding: 0 20px;
    }}

    /* KPI Summary Card Grid */
    .kpi-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }}

    .kpi-card {{
      background-color: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 24px;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: var(--transition);
    }}

    .kpi-card:hover {{
      transform: translateY(-3px);
    }}

    .kpi-label {{
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-secondary);
      margin-bottom: 8px;
    }}

    .kpi-value {{
      font-size: 2.2rem;
      font-weight: 700;
      color: var(--text-primary);
      line-height: 1.1;
    }}

    .kpi-subtext {{
      font-size: 0.8rem;
      color: var(--text-secondary);
      margin-top: 10px;
    }}

    /* Platform Sections Side-by-Side */
    .platform-row {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 30px;
      margin-bottom: 30px;
    }}

    @media (max-width: 992px) {{
      .platform-row {{
        grid-template-columns: 1fr;
      }}
    }}

    .platform-card {{
      background-color: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 30px;
      box-shadow: var(--shadow);
      display: flex;
      flex-direction: column;
      transition: var(--transition);
    }}

    .platform-header {{
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
      border-bottom: 2px solid var(--border-color);
      padding-bottom: 12px;
    }}

    .platform-badge {{
      width: 14px;
      height: 14px;
      border-radius: 50%;
    }}

    .platform-badge.gp {{
      background-color: var(--gp-color);
    }}

    .platform-badge.as {{
      background-color: var(--as-color);
    }}

    .platform-header h2 {{
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--text-primary);
    }}

    /* Tables */
    .table-container {{
      overflow-x: auto;
      margin-bottom: 20px;
    }}

    table.comparison-table {{
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.9rem;
    }}

    table.comparison-table th, table.comparison-table td {{
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
    }}

    table.comparison-table th {{
      background-color: var(--bg-tertiary);
      font-weight: 700;
      color: var(--text-primary);
    }}

    table.comparison-table tr:hover td {{
      background-color: var(--bg-tertiary);
    }}

    /* AI Analysis text block */
    .analysis-block {{
      background-color: var(--bg-tertiary);
      border-radius: 8px;
      padding: 20px;
      margin-top: 15px;
      flex-grow: 1;
      font-size: 0.92rem;
      border-left: 4px solid var(--primary-color);
    }}

    .analysis-block.as-theme {{
      border-left-color: var(--as-color);
    }}

    .analysis-block.gp-theme {{
      border-left-color: var(--gp-color);
    }}

    .analysis-block h3 {{
      font-size: 0.95rem;
      font-weight: 700;
      margin-bottom: 10px;
      color: var(--text-primary);
    }}

    .analysis-block p {{
      margin-bottom: 8px;
    }}

    .analysis-list {{
      margin-left: 20px;
      margin-bottom: 8px;
    }}

    .analysis-list li {{
      margin-bottom: 4px;
    }}

    /* Recommendations Block */
    .recommendations-card {{
      background-color: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 30px;
      box-shadow: var(--shadow);
      margin-bottom: 30px;
      border-left: 6px solid var(--accent-color);
      transition: var(--transition);
    }}

    .recommendations-card h2 {{
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--accent-color);
      margin-bottom: 15px;
      display: flex;
      align-items: center;
      gap: 8px;
    }}

    .recommendations-content {{
      background-color: var(--accent-light);
      color: var(--text-primary);
      padding: 20px 24px;
      border-radius: 8px;
      font-size: 0.95rem;
    }}

    .recommendations-content ul {{
      margin-left: 20px;
      margin-top: 10px;
    }}

    .recommendations-content li {{
      margin-bottom: 10px;
      font-weight: 500;
    }}

    /* Charts Row */
    .charts-row {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 30px;
      margin-bottom: 30px;
    }}

    @media (max-width: 576px) {{
      .charts-row {{
        grid-template-columns: 1fr;
      }}
    }}

    .chart-card {{
      background-color: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 24px;
      box-shadow: var(--shadow);
      min-height: 380px;
      transition: var(--transition);
    }}

    .chart-card h3 {{
      font-size: 1rem;
      font-weight: 700;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 10px;
      color: var(--text-primary);
    }}

    .chart-wrapper {{
      position: relative;
      height: 280px;
      width: 100%;
    }}

    /* Explorer / Table search controls */
    .explorer-card {{
      background-color: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 30px;
      box-shadow: var(--shadow);
      transition: var(--transition);
    }}

    .explorer-card h2 {{
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 20px;
      color: var(--text-primary);
    }}

    .filter-bar {{
      display: flex;
      flex-wrap: wrap;
      gap: 15px;
      margin-bottom: 20px;
      background-color: var(--bg-tertiary);
      padding: 15px 20px;
      border-radius: 8px;
      border: 1px solid var(--border-color);
    }}

    .filter-group {{
      display: flex;
      flex-direction: column;
      gap: 6px;
    }}

    .filter-group label {{
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--text-secondary);
    }}

    .filter-group input, .filter-group select {{
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid var(--border-color);
      background-color: var(--bg-secondary);
      color: var(--text-primary);
      font-size: 0.9rem;
      outline: none;
      min-width: 150px;
      transition: var(--transition);
    }}

    .filter-group input:focus, .filter-group select:focus {{
      border-color: var(--primary-color);
    }}

    .filter-group.search {{
      flex-grow: 1;
    }}

    .filter-group.search input {{
      width: 100%;
    }}

    /* Review Grid Table */
    .reviews-table-container {{
      max-height: 600px;
      overflow-y: auto;
      border: 1px solid var(--border-color);
      border-radius: 8px;
    }}

    table.reviews-table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }}

    table.reviews-table th, table.reviews-table td {{
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
      vertical-align: top;
    }}

    table.reviews-table th {{
      background-color: var(--bg-tertiary);
      font-weight: 700;
      position: sticky;
      top: 0;
      z-index: 10;
      color: var(--text-primary);
      text-align: left;
    }}

    table.reviews-table tr:hover td {{
      background-color: var(--bg-tertiary);
    }}

    .rank-badge {{
      font-size: 0.8rem;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      display: inline-block;
      text-align: center;
    }}
    .rank-up {{ background-color: #fce4d6; color: #c65911; }}
    .rank-down {{ background-color: #e2efda; color: #375623; }}
    .rank-same {{ background-color: #f2f2f2; color: #595959; }}
    .rank-new {{ background-color: #f2dbfc; color: #7030a0; }}
    .rank-resolved {{ background-color: #d9e1f2; color: #1f4e79; }}

    /* Sentiment badges */
    .badge {{
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-align: center;
    }}

    .badge.pos {{ background-color: #d4edda; color: #155724; }}
    .badge.neg {{ background-color: #f8d7da; color: #721c24; }}
    .badge.mix {{ background-color: #fff3cd; color: #856404; }}
    .badge.neu {{ background-color: #e2e3e5; color: #383d41; }}

    .badge.store-gp {{ background-color: var(--gp-light); color: var(--gp-color); }}
    .badge.store-as {{ background-color: var(--as-light); color: var(--as-color); }}

    .stars-cell {{
      font-weight: 600;
      color: #f39c12;
      white-space: nowrap;
    }}

    .content-cell {{
      max-width: 450px;
      word-wrap: break-word;
      white-space: normal;
    }}

    .pagination-bar {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 15px;
      font-size: 0.9rem;
      color: var(--text-secondary);
    }}

    .pagination-btns {{
      display: flex;
      gap: 10px;
    }}

    .btn {{
      padding: 6px 12px;
      border-radius: 4px;
      border: 1px solid var(--border-color);
      background-color: var(--bg-secondary);
      color: var(--text-primary);
      cursor: pointer;
      font-weight: 600;
      transition: var(--transition);
    }}

    .btn:hover:not(:disabled) {{
      background-color: var(--bg-tertiary);
    }}

    .btn:disabled {{
      opacity: 0.5;
      cursor: not-allowed;
    }}
  </style>
</head>
<body>

  <header>
    <div class="header-title">
      <h1>Crossfire Legends</h1>
      <p data-i18n="header_p">Báo cáo Phản hồi & Đánh giá của Người chơi (Thị trường VN) • Sensor Tower</p>
    </div>
    <div class="header-controls">
      <div class="lang-selector">
        <button class="lang-btn active" data-lang="vi">VN</button>
        <button class="lang-btn" data-lang="en">EN</button>
        <button class="lang-btn" data-lang="zh">CN</button>
      </div>
      <button class="theme-toggle-btn" id="themeToggle">
        <span id="themeToggleIcon">🌙</span> <span id="themeToggleText" data-i18n="theme_dark">Chế độ tối</span>
      </button>
    </div>
  </header>

  <div class="container">

    <!-- KPI Summary Grid -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label" data-i18n="kpi_total_label">Tổng số review thu thập</div>
        <div class="kpi-value">{total_reviews:,}</div>
        <div class="kpi-subtext" data-i18n="kpi_total_sub">Từ ngày 03/03/2026 đến nay</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label" data-i18n="kpi_avg_label">Điểm đánh giá trung bình</div>
        <div class="kpi-value">{avg_rating:.2f} <span style="font-size: 1.2rem; color: #f39c12;">★</span></div>
        <div class="kpi-subtext" data-i18n="kpi_avg_sub">Trên thang điểm 5.0</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label" data-i18n="kpi_neg_ratio_label">Tỷ lệ tiêu cực / hỗn hợp</div>
        <div class="kpi-value">{neg_ratio_pct:.1f}%</div>
        <div class="kpi-subtext" id="kpiNegSub" data-neg-reviews="{neg_reviews}">Chiếm {neg_reviews:,} đánh giá cần lưu ý</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label" data-i18n="kpi_top_issue_label">Lỗi nổi cộm nhất (Version 3)</div>
        <div class="kpi-value" id="kpiTopIssueVal" data-raw-val="{top_v3_issue}" style="font-size: 1.5rem; height: 100%; display: flex; align-items: center; font-weight: 700; color: var(--accent-color);">{top_v3_issue}</div>
        <div class="kpi-subtext" data-i18n="kpi_top_issue_sub">Phiên bản từ ngày 28/04</div>
      </div>
    </div>

    <!-- Recommendations block -->
    <div class="recommendations-card">
      <h2 data-i18n="rec_title">⚠️ KHUYẾN NGHỊ VẬN HÀNH & TỐI ƯU TRẢI NGHIỆM PHIÊN BẢN MỚI (VERSION 3)</h2>
      <div class="recommendations-content">
        {recommendations_html_vi}
      </div>
    </div>

    <!-- Platform detailed sections row -->
    <div class="platform-row">
      <!-- Google Play Card -->
      <div class="platform-card">
        <div class="platform-header">
          <div class="platform-badge gp"></div>
          <h2>Google Play - Phiên bản V2 vs V3</h2>
        </div>
        <div class="table-container">
          <table class="comparison-table">
            <thead>
              <tr>
                <th data-i18n-th="th_metric_gp">Chỉ số (Google Play)</th>
                <th>V2 (03/03 - 27/04)</th>
                <th>V3 (28/04 - Present)</th>
              </tr>
            </thead>
            <tbody>
              {"".join(f"<tr data-row-metric='{row['metric']}'><td>{row['metric']}</td><td>{row['v2']}</td><td>{row['v3']}</td></tr>" for row in gp_table)}
            </tbody>
          </table>
        </div>
        <div class="analysis-block gp-theme">
          <h3 data-i18n="trend_eval_title">📊 Đánh giá xu hướng:</h3>
          {gp_text_html_vi}
        </div>
      </div>

      <!-- App Store Card -->
      <div class="platform-card">
        <div class="platform-header">
          <div class="platform-badge as"></div>
          <h2>App Store - Phiên bản V2 vs V3</h2>
        </div>
        <div class="table-container">
          <table class="comparison-table">
            <thead>
              <tr>
                <th data-i18n-th="th_metric_as">Chỉ số (App Store)</th>
                <th>V2 (03/03 - 27/04)</th>
                <th>V3 (28/04 - Present)</th>
              </tr>
            </thead>
            <tbody>
              {"".join(f"<tr data-row-metric='{row['metric']}'><td>{row['metric']}</td><td>{row['v2']}</td><td>{row['v3']}</td></tr>" for row in as_table)}
            </tbody>
          </table>
        </div>
        <div class="analysis-block as-theme">
          <h3 data-i18n="trend_eval_title">📊 Đánh giá xu hướng:</h3>
          {as_text_html_vi}
        </div>
      </div>
    </div>

    <!-- Issue Ranking Section -->
    <div class="platform-row" style="margin-top: 30px;">
      <!-- Google Play Issue Rank Card -->
      <div class="platform-card">
        <div class="platform-header">
          <div class="platform-badge gp"></div>
          <h2>Google Play - Xếp hạng & Biến động lỗi tiêu cực</h2>
        </div>
        <div class="table-container">
          <table class="comparison-table">
            <thead>
              <tr>
                <th>Vấn đề (Category)</th>
                <th>Hạng V2 (% - CMT)</th>
                <th>Hạng V3 (% - CMT)</th>
                <th>Tổng CMT Tiêu Cực</th>
                <th>Đánh giá biến động</th>
              </tr>
            </thead>
            <tbody>
              {"".join(f"<tr><td data-raw-cat='{row['category']}'>{row['category']}</td><td data-raw-val='{row['v2_display']}'>{row['v2_display']}</td><td data-raw-val='{row['v3_display']}'>{row['v3_display']}</td><td style='text-align: center; font-weight: bold;'>{row['total_count']}</td><td><span class='rank-badge {row['change_class']}' data-raw-val='{row['change_text']}'>{row['change_text']}</span></td></tr>" for row in gp_ranks)}
            </tbody>
          </table>
        </div>
      </div>

      <!-- App Store Issue Rank Card -->
      <div class="platform-card">
        <div class="platform-header">
          <div class="platform-badge as"></div>
          <h2>App Store - Xếp hạng & Biến động lỗi tiêu cực</h2>
        </div>
        <div class="table-container">
          <table class="comparison-table">
            <thead>
              <tr>
                <th>Vấn đề (Category)</th>
                <th>Hạng V2 (% - CMT)</th>
                <th>Hạng V3 (% - CMT)</th>
                <th>Tổng CMT Tiêu Cực</th>
                <th>Đánh giá biến động</th>
              </tr>
            </thead>
            <tbody>
              {"".join(f"<tr><td data-raw-cat='{row['category']}'>{row['category']}</td><td data-raw-val='{row['v2_display']}'>{row['v2_display']}</td><td data-raw-val='{row['v3_display']}'>{row['v3_display']}</td><td style='text-align: center; font-weight: bold;'>{row['total_count']}</td><td><span class='rank-badge {row['change_class']}' data-raw-val='{row['change_text']}'>{row['change_text']}</span></td></tr>" for row in as_ranks)}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Interactive Charts Row -->
    <div class="charts-row">
      <!-- Chart 1: Sentiment Compare -->
      <div class="chart-card">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); margin-bottom: 20px; padding-bottom: 10px;">
          <h3 style="border-bottom: none; margin-bottom: 0; padding-bottom: 0;" data-i18n="chart_sentiment_title">Tỉ lệ Sắc thái Phản hồi (Sentiment V2 vs V3)</h3>
          <div class="chart-controls" style="display: flex; gap: 8px;">
            <button class="btn btn-chart-tab active" data-store="ALL" data-i18n="val_all">Tất cả</button>
            <button class="btn btn-chart-tab" data-store="Google Play">Google Play</button>
            <button class="btn btn-chart-tab" data-store="App Store">App Store</button>
          </div>
        </div>
        <div class="chart-wrapper">
          <canvas id="sentimentChart"></canvas>
        </div>
      </div>

      <!-- Chart 2: Rating distribution -->
      <div class="chart-card">
        <h3 data-i18n="chart_rating_title">Phân bố Điểm Đánh giá (Rating Distribution by Store)</h3>
        <div class="chart-wrapper">
          <canvas id="ratingChart"></canvas>
        </div>
      </div>
    </div>

    <!-- Review Explorer Tab -->
    <div class="explorer-card">
      <h2 data-i18n="exp_title">🔍 Tra Cứu Chi Tiết Ý Kiến & Phản Hồi Từ Người Chơi</h2>
      
      <div class="filter-bar">
        <div class="filter-group search">
          <label for="searchInput" data-i18n="lbl_search">Tìm kiếm từ khóa</label>
          <input type="text" id="searchInput" data-i18n="ph_search" placeholder="Ví dụ: lag, lỗi nạp, văng game, hack...">
        </div>
        <div class="filter-group">
          <label for="storeFilter" data-i18n="lbl_store">Cửa hàng (Store)</label>
          <select id="storeFilter">
            <option value="all" data-i18n="val_all">Tất cả</option>
            <option value="Google Play">Google Play</option>
            <option value="App Store">App Store</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="versionFilter" data-i18n="lbl_version">Phiên bản (Version)</label>
          <select id="versionFilter">
            <option value="all" data-i18n="val_all">Tất cả</option>
            <option value="Version 2 (03/03 - 27/04)">Version 2 (03/03 - 27/04)</option>
            <option value="Version 3 (28/04 - Present)">Version 3 (28/04 - Present)</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="sentimentFilter" data-i18n="lbl_sentiment">Sắc thái (Sentiment)</label>
          <select id="sentimentFilter">
            <option value="all" data-i18n="val_all">Tất cả</option>
            <option value="Tích cực">Tích cực</option>
            <option value="Tiêu cực">Tiêu cực</option>
            <option value="Hỗn hợp">Hỗn hợp</option>
            <option value="Trung lập">Trung lập</option>
          </select>
        </div>
        <div class="filter-group">
          <label for="categoryFilter" data-i18n="lbl_category">Phân loại lỗi</label>
          <select id="categoryFilter">
            {category_options_html}
          </select>
        </div>
      </div>

      <div class="reviews-table-container">
        <table class="reviews-table">
          <thead>
            <tr>
              <th style="width: 100px;" data-i18n="th_exp_time">Thời gian</th>
              <th style="width: 100px;" data-i18n="th_exp_platform">Nền tảng</th>
              <th style="width: 80px;" data-i18n="th_exp_rating">Rating</th>
              <th style="width: 90px;" data-i18n="th_exp_sentiment">Sắc thái</th>
              <th style="width: 120px;" data-i18n="th_exp_category">Nhóm lỗi</th>
              <th data-i18n="th_exp_content">Nội dung bình luận</th>
            </tr>
          </thead>
          <tbody id="reviewsTableBody">
            <!-- Rendered by JS -->
          </tbody>
        </table>
      </div>

      <div class="pagination-bar">
        <div id="paginationInfo">Đang hiển thị 1-50 trong tổng số ... reviews</div>
        <div class="pagination-btns">
          <button class="btn" id="prevPageBtn" disabled>Trang trước</button>
          <button class="btn" id="nextPageBtn">Trang sau</button>
        </div>
      </div>
      <div id="originalNote" style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 10px; font-style: italic;"></div>
    </div>

  </div>

  <script>
    // 1. Data Inject from Python
    const rawReviews = {json.dumps(reviews_json_list, ensure_ascii=False)};
    const sentimentDist = {json.dumps(sentiment_dist, ensure_ascii=False)};
    const ratingDist = {json.dumps(rating_dist, ensure_ascii=False)};
    
    // 2. Light / Dark Theme switching
    const themeToggleBtn = document.getElementById('themeToggle');
    const themeToggleIcon = document.getElementById('themeToggleIcon');
    const themeToggleText = document.getElementById('themeToggleText');

    // 3. I18N Dictionaries & Engine
    const categoryTranslations = {{
      "Vấn Nạn Hack / Cheat": {{ vi: "Vấn Nạn Hack / Cheat", en: "Hack / Cheat Issues", zh: "外挂/作弊问题" }},
      "Lỗi Văng Game / Crash": {{ vi: "Lỗi Văng Game / Crash", en: "Crash / Game Freezing", zh: "游戏崩溃/闪退" }},
      "Lỗi Giật Lag / Drop FPS": {{ vi: "Lỗi Giật Lag / Drop FPS", en: "Lag / Drop FPS", zh: "卡顿/掉帧" }},
      "Lỗi Kết Nối / Đăng Nhập": {{ vi: "Lỗi Kết Nối / Đăng Nhập", en: "Connection / Login Issues", zh: "连接/登录问题" }},
      "Lỗi Ghép Trận": {{ vi: "Lỗi Ghép Trận", en: "Matchmaking Issues", zh: "匹配机制问题" }},
      "Lỗi Cập Nhật / Đứng Tải": {{ vi: "Lỗi Cập Nhật / Đứng Tải", en: "Update / Download Stuck", zh: "更新/下载卡进度" }},
      "Lỗi Âm Thanh / Hình Ảnh": {{ vi: "Lỗi Âm Thanh / Hình Ảnh", en: "Audio / Graphic Issues", zh: "音效/画面问题" }},
      "Lỗi Nạp Tiền / Giao Dịch": {{ vi: "Lỗi Nạp Tiền / Giao Dịch", en: "Top-up / Transaction Issues", zh: "充值/交易问题" }},
      "Cân Bằng Gameplay": {{ vi: "Cân Bằng Gameplay", en: "Gameplay Balance", zh: "游戏玩法平衡" }},
      "Ý Kiến Khác / Chê Chung": {{ vi: "Ý Kiến Khác / Chê Chung", en: "Other Comments / General Criticisms", zh: "其他意见/一般批评" }},
      "Khen": {{ vi: "Khen", en: "Praise", zh: "好评" }}
    }};

    const sentimentTranslations = {{
      "Tích cực": {{ vi: "Tích cực", en: "Positive", zh: "积极" }},
      "Tiêu cực": {{ vi: "Tiêu cực", en: "Negative", zh: "消极" }},
      "Hỗn hợp": {{ vi: "Hỗn hợp", en: "Mixed", zh: "混合" }},
      "Trung lập": {{ vi: "Trung lập", en: "Neutral", zh: "中立" }}
    }};

    const changeTrans = {{
      "Không đổi ➖": {{ vi: "Không đổi ➖", en: "Unchanged ➖", zh: "无变化 ➖" }},
      "Mới ở V3 🆕 (Cần lưu ý!)": {{ vi: "Mới ở V3 🆕 (Cần lưu ý!)", en: "New in V3 🆕 (Notice!)", zh: "第 3 版新增 🆕 (需注意！)" }},
      "Biến mất ở V3 🟢 (Đã khắc phục)": {{ vi: "Biến mất ở V3 🟢 (Đã khắc phục)", en: "Resolved in V3 🟢 (Fixed)", zh: "第 3 版消失 🟢 (已解决)" }}
    }};

    const translations = {{
      vi: {{
        page_title: "Báo Cáo Trải Nghiệm Người Dùng Crossfire Legends VN",
        header_p: "Báo cáo Phản hồi & Đánh giá của Người chơi (Thị trường VN) • Sensor Tower",
        theme_dark: "Chế độ tối",
        theme_light: "Chế độ sáng",
        
        kpi_total_label: "Tổng số review thu thập",
        kpi_total_sub: "Từ ngày 03/03/2026 đến nay",
        kpi_avg_label: "Điểm đánh giá trung bình",
        kpi_avg_sub: "Trên thang điểm 5.0",
        kpi_neg_ratio_label: "Tỷ lệ tiêu cực / hỗn hợp",
        kpi_neg_ratio_sub: "Chiếm {{neg_reviews}} đánh giá cần lưu ý",
        kpi_top_issue_label: "Lỗi nổi cộm nhất (Version 3)",
        kpi_top_issue_sub: "Phiên bản từ ngày 28/04",
        
        rec_title: "⚠️ KHUYẾN NGHỊ VẬN HÀNH & TỐI ƯU TRẢI NGHIỆM PHIÊN BẢN MỚI (VERSION 3)",
        trend_eval_title: "📊 Đánh giá xu hướng:",
        
        th_metric_gp: "Chỉ số (Google Play)",
        th_metric_as: "Chỉ số (App Store)",
        th_v2: "V2 (03/03 - 27/04)",
        th_v3: "V3 (28/04 - Present)",
        
        th_category: "Vấn đề (Category)",
        th_v2_display: "Hạng V2 (% - CMT)",
        th_v3_display: "Hạng V3 (% - CMT)",
        th_total_neg: "Tổng CMT Tiêu Cực",
        th_change: "Đánh giá biến động",
        
        // Explorer
        exp_title: "🔍 Tra Cứu Chi Tiết Ý Kiến & Phản Hồi Từ Người Chơi",
        lbl_search: "Tìm kiếm từ khóa",
        ph_search: "Ví dụ: lag, lỗi nạp, văng game, hack...",
        lbl_store: "Cửa hàng (Store)",
        lbl_version: "Phiên bản (Version)",
        lbl_sentiment: "Sắc thái (Sentiment)",
        lbl_category: "Phân loại lỗi",
        
        val_all: "Tất cả",
        val_all_with_count: "Tất cả ({{count}})",
        
        th_exp_time: "Thời gian",
        th_exp_platform: "Nền tảng",
        th_exp_rating: "Rating",
        th_exp_sentiment: "Sắc thái",
        th_exp_category: "Nhóm lỗi",
        th_exp_content: "Nội dung bình luận",
        
        exp_empty: "Không tìm thấy đánh giá nào khớp với điều kiện lọc.",
        exp_pagination: "Đang hiển thị {{start}} - {{end}} của {{total}} reviews",
        btn_prev: "Trang trước",
        btn_next: "Trang sau",
        
        chart_sentiment_title: "Tỉ lệ Sắc thái Phản hồi (Sentiment V2 vs V3)",
        chart_rating_title: "Phân bố Điểm Đánh giá (Rating Distribution by Store)",
        
        original_note: ""
      }},
      en: {{
        page_title: "Crossfire Legends VN User Experience Report",
        header_p: "Player Feedback & Review Report (VN Market) • Sensor Tower",
        theme_dark: "Dark Mode",
        theme_light: "Light Mode",
        
        kpi_total_label: "Total reviews collected",
        kpi_total_sub: "From 03/03/2026 to present",
        kpi_avg_label: "Average rating",
        kpi_avg_sub: "On a 5.0 scale",
        kpi_neg_ratio_label: "Negative / mixed ratio",
        kpi_neg_ratio_sub: "Accounting for {{neg_reviews}} reviews to note",
        kpi_top_issue_label: "Top issue (Version 3)",
        kpi_top_issue_sub: "Version since 28/04",
        
        rec_title: "⚠️ OPERATIONAL RECOMMENDATIONS & EXPERIENCE OPTIMIZATION FOR NEW VERSION (VERSION 3)",
        trend_eval_title: "📊 Trend Evaluation:",
        
        th_metric_gp: "Metric (Google Play)",
        th_metric_as: "Metric (App Store)",
        th_v2: "V2 (03/03 - 27/04)",
        th_v3: "V3 (28/04 - Present)",
        
        th_category: "Issue (Category)",
        th_v2_display: "V2 Rank (% - CMT)",
        th_v3_display: "V3 Rank (% - CMT)",
        th_total_neg: "Total Neg CMT",
        th_change: "Fluctuation Assessment",
        
        // Explorer
        exp_title: "🔍 Detailed Player Review & Feedback Lookup",
        lbl_search: "Keyword Search",
        ph_search: "e.g.: lag, top-up, crash, hack...",
        lbl_store: "Store",
        lbl_version: "Version",
        lbl_sentiment: "Sentiment",
        lbl_category: "Issue Category",
        
        val_all: "All",
        val_all_with_count: "All ({{count}})",
        
        th_exp_time: "Time",
        th_exp_platform: "Platform",
        th_exp_rating: "Rating",
        th_exp_sentiment: "Sentiment",
        th_exp_category: "Issue Category",
        th_exp_content: "Comment Content",
        
        exp_empty: "No reviews match the filtering criteria.",
        exp_pagination: "Showing {{start}} - {{end}} of {{total}} reviews",
        btn_prev: "Previous",
        btn_next: "Next",
        
        chart_sentiment_title: "Response Sentiment Ratio (Sentiment V2 vs V3)",
        chart_rating_title: "Rating Distribution (Rating Distribution by Store)",
        
        original_note: "* Note: Review comments are kept in their original Vietnamese language."
      }},
      zh: {{
        page_title: "Crossfire Legends 越南用户体验报告",
        header_p: "玩家反馈与评论报告（越南市场）• Sensor Tower",
        theme_dark: "深色模式",
        theme_light: "浅色模式",
        
        kpi_total_label: "收集的评论总数",
        kpi_total_sub: "自 2026 年 3 月 3 日至今",
        kpi_avg_label: "平均评分",
        kpi_avg_sub: "基于 5.0 分制",
        kpi_neg_ratio_label: "消极/混合反馈比例",
        kpi_neg_ratio_sub: "占需要注意的 {{neg_reviews}} 条评论",
        kpi_top_issue_label: "最突出问题 (第 3 版)",
        kpi_top_issue_sub: "自 4 月 28 日起的版本",
        
        rec_title: "⚠️ 新版本运营建议与体验优化（第 3 版）",
        trend_eval_title: "📊 趋势评估：",
        
        th_metric_gp: "指标 (Google Play)",
        th_metric_as: "指标 (App Store)",
        th_v2: "V2 (03/03 - 27/04)",
        th_v3: "V3 (28/04 - Present)",
        
        th_category: "问题类别",
        th_v2_display: "第 2 版排名 (% - 评论)",
        th_v3_display: "第 3 版排名 (% - 评论)",
        th_total_neg: "消极评论总数",
        th_change: "变动评估",
        
        // Explorer
        exp_title: "🔍 玩家意见与反馈详细查询",
        lbl_search: "关键词搜索",
        ph_search: "例如：卡顿、充值失败、闪退、外挂……",
        lbl_store: "应用商店",
        lbl_version: "版本",
        lbl_sentiment: "情感倾向",
        lbl_category: "问题分类",
        
        val_all: "全部",
        val_all_with_count: "全部 ({{count}})",
        
        th_exp_time: "时间",
        th_exp_platform: "平台",
        th_exp_rating: "评分",
        th_exp_sentiment: "情感倾向",
        th_exp_category: "问题分类",
        th_exp_content: "评论内容",
        
        exp_empty: "未找到符合过滤条件的评论。",
        exp_pagination: "显示第 {{start}} - {{end}} 条，共 {{total}} 条评论",
        btn_prev: "上一页",
        btn_next: "下一页",
        
        chart_sentiment_title: "情感倾向分布比例 (第 2 版 vs 第 3 版)",
        chart_rating_title: "星级评分分布情况 (按应用商店划分)",
        
        original_note: "* 注：评论内容保留原始越南语。"
      }}
    }};

    const recommendationsHtml = {{
      vi: `{recommendations_html_vi}`,
      en: `{recommendations_html_en}`,
      zh: `{recommendations_html_zh}`
    }};

    const gpTextHtml = {{
      vi: `{gp_text_html_vi}`,
      en: `{gp_text_html_en}`,
      zh: `{gp_text_html_zh}`
    }};

    const asTextHtml = {{
      vi: `{as_text_html_vi}`,
      en: `{as_text_html_en}`,
      zh: `{as_text_html_zh}`
    }};

    let currentLang = 'vi';

    function translateCategoryList(catStr, lang) {{
      if (!catStr) return "";
      return catStr.split(", ").map(cat => {{
        const trimmed = cat.trim();
        return (categoryTranslations[trimmed] && categoryTranslations[trimmed][lang]) || trimmed;
      }}).join(", ");
    }}

    function translateRankCell(val, lang) {{
      if (val === "N/A" || !val) return "N/A";
      const match = val.match(/#(\d+) - ([\d\.]+)% \((\d+)\)/);
      if (match) {{
        const rank = match[1];
        const pct = match[2];
        const count = match[3];
        if (lang === 'vi') {{
          return `#${{rank}} - ${{pct}}% (${{count}})`;
        }} else if (lang === 'zh') {{
          return `第 ${{rank}} - ${{pct}}% (${{count}} 条评论)`;
        }} else {{
          return `#${{rank}} - ${{pct}}% (${{count}} reviews)`;
        }}
      }}
      return val;
    }}

    function translateChangeText(val, lang) {{
      const trimmed = val.trim();
      if (changeTrans[trimmed]) return changeTrans[trimmed][lang];
      
      const mUp = trimmed.match(/Tăng (\d+) bậc 🔺 \(Nghiêm trọng hơn\)/);
      if (mUp) {{
        const n = mUp[1];
        if (lang === 'vi') return trimmed;
        if (lang === 'zh') return `上升 ${{n}} 位 🔺 (更为严重)`;
        return `Up ${{n}} rank(s) 🔺 (More severe)`;
      }}
      
      const mDown = trimmed.match(/Giảm (\d+) bậc 🔻 \(Cải thiện\)/);
      if (mDown) {{
        const n = mDown[1];
        if (lang === 'vi') return trimmed;
        if (lang === 'zh') return `下降 ${{n}} 位 🔻 (有所改善)`;
        return `Down ${{n}} rank(s) 🔻 (Improved)`;
      }}
      
      return val;
    }}

    function setLanguage(lang) {{
      currentLang = lang;
      
      // Update switcher active states
      document.querySelectorAll('.lang-btn').forEach(btn => {{
        if (btn.getAttribute('data-lang') === lang) {{
          btn.classList.add('active');
        }} else {{
          btn.classList.remove('active');
        }}
      }});
      
      // Page title
      document.title = translations[lang].page_title;
      
      // Theme toggle dynamic updates
      const isDark = document.body.classList.contains('dark');
      themeToggleText.textContent = isDark ? translations[lang].theme_light : translations[lang].theme_dark;
      
      // data-i18n translation
      document.querySelectorAll('[data-i18n]').forEach(el => {{
        const key = el.getAttribute('data-i18n');
        if (translations[lang][key]) {{
          if (el.tagName === 'INPUT') {{
            el.placeholder = translations[lang][key];
          }} else {{
            el.textContent = translations[lang][key];
          }}
        }}
      }});

      // KPI Card 3 subtext
      const kpiNegSub = document.getElementById('kpiNegSub');
      if (kpiNegSub) {{
        const negReviewsCount = kpiNegSub.getAttribute('data-neg-reviews');
        kpiNegSub.textContent = translations[lang].kpi_neg_ratio_sub.replace('{{neg_reviews}}', Number(negReviewsCount).toLocaleString(lang === 'zh' ? 'zh-CN' : (lang === 'en' ? 'en-US' : 'vi-VN')));
      }}
      
      // KPI Top issue
      const kpiTopIssueVal = document.getElementById('kpiTopIssueVal');
      if (kpiTopIssueVal) {{
        const rawIssue = kpiTopIssueVal.getAttribute('data-raw-val');
        kpiTopIssueVal.textContent = (categoryTranslations[rawIssue] && categoryTranslations[rawIssue][lang]) || rawIssue;
      }}
      
      // Recommendations block
      const recContent = document.querySelector('.recommendations-content');
      if (recContent && recommendationsHtml[lang]) {{
        recContent.innerHTML = recommendationsHtml[lang];
      }}
      
      // Platform trend evaluations
      const gpAssess = document.querySelector('.gp-theme');
      if (gpAssess && gpTextHtml[lang]) {{
        gpAssess.innerHTML = `<h3 data-i18n="trend_eval_title">${{translations[lang].trend_eval_title}}</h3>` + gpTextHtml[lang];
      }}
      const asAssess = document.querySelector('.as-theme');
      if (asAssess && asTextHtml[lang]) {{
        asAssess.innerHTML = `<h3 data-i18n="trend_eval_title">${{translations[lang].trend_eval_title}}</h3>` + asTextHtml[lang];
      }}

      // Comparison Table headers
      document.querySelectorAll('table.comparison-table').forEach(table => {{
        const headers = table.querySelectorAll('thead th');
        if (headers.length === 3) {{
          const thAttr = headers[0].getAttribute('data-i18n-th');
          if (thAttr === 'th_metric_gp') {{
            headers[0].textContent = translations[lang].th_metric_gp;
          }} else if (thAttr === 'th_metric_as') {{
            headers[0].textContent = translations[lang].th_metric_as;
          }}
          headers[1].textContent = translations[lang].th_v2;
          headers[2].textContent = translations[lang].th_v3;
        }} else if (headers.length === 5) {{
          headers[0].textContent = translations[lang].th_category;
          headers[1].textContent = translations[lang].th_v2_display;
          headers[2].textContent = translations[lang].th_v3_display;
          headers[3].textContent = translations[lang].th_total_neg;
          headers[4].textContent = translations[lang].th_change;
        }}
      }});

      // Translate Table Cell values
      const rowNameTranslations = {{
        "Tổng số đánh giá (Total Reviews)": {{ vi: "Tổng số đánh giá (Total Reviews)", en: "Total Reviews", zh: "总评论数" }},
        "Điểm đánh giá TB (Avg Rating)": {{ vi: "Điểm đánh giá TB (Avg Rating)", en: "Avg Rating", zh: "平均评分" }},
        "Tỷ lệ Tích cực (Positive %)": {{ vi: "Tỷ lệ Tích cực (Positive %)", en: "Positive %", zh: "好评率 (%)" }},
        "Tỷ lệ Tiêu cực (Negative %)": {{ vi: "Tỷ lệ Tiêu cực (Negative %)", en: "Negative %", zh: "差评率 (%)" }},
        "Vấn đề chính (Top Issue)": {{ vi: "Vấn đề chính (Top Issue)", en: "Top Issue", zh: "主要问题" }}
      }};

      document.querySelectorAll('table.comparison-table tbody tr').forEach(row => {{
        const cells = row.querySelectorAll('td');
        if (cells.length === 3) {{
          const rawMetric = row.getAttribute('data-row-metric');
          if (rowNameTranslations[rawMetric]) {{
            cells[0].textContent = rowNameTranslations[rawMetric][lang];
          }}
          
          for (let i = 1; i <= 2; i++) {{
            const rawVal = cells[i].getAttribute('data-raw-val') || cells[i].textContent;
            if (!cells[i].getAttribute('data-raw-val')) {{
              cells[i].setAttribute('data-raw-val', rawVal);
            }}
            
            if (rawVal.includes('cmt')) {{
              const numMatch = rawVal.match(/\((\d+) cmt\)/);
              if (numMatch) {{
                const num = numMatch[1];
                const pct = rawVal.split('(')[0].trim();
                if (lang === 'vi') {{
                  cells[i].textContent = `${{pct}} (${{num}} cmt)`;
                }} else if (lang === 'zh') {{
                  cells[i].textContent = `${{pct}} (${{num}} 条评论)`;
                }} else {{
                  cells[i].textContent = `${{pct}} (${{num}} reviews)`;
                }}
              }}
            }} else {{
              const trimmed = rawVal.trim();
              if (categoryTranslations[trimmed]) {{
                cells[i].textContent = categoryTranslations[trimmed][lang];
              }}
            }}
          }}
        }} else if (cells.length === 5) {{
          const rawCat = cells[0].getAttribute('data-raw-cat');
          cells[0].textContent = (categoryTranslations[rawCat] && categoryTranslations[rawCat][lang]) || rawCat;
          
          const rawV2 = cells[1].getAttribute('data-raw-val');
          cells[1].textContent = translateRankCell(rawV2, lang);
          
          const rawV3 = cells[2].getAttribute('data-raw-val');
          cells[2].textContent = translateRankCell(rawV3, lang);
          
          const badge = cells[4].querySelector('.rank-badge');
          if (badge) {{
            const rawChange = badge.getAttribute('data-raw-val');
            badge.textContent = translateChangeText(rawChange, lang);
          }}
        }}
      }});

      // Update Filter Options
      const categoryFilter = document.getElementById('categoryFilter');
      if (categoryFilter) {{
        categoryFilter.querySelectorAll('option').forEach(opt => {{
          const rawVal = opt.value;
          const count = opt.getAttribute('data-count');
          if (rawVal === 'all') {{
            opt.textContent = translations[lang].val_all_with_count.replace('{{count}}', count);
          }} else {{
            const transName = (categoryTranslations[rawVal] && categoryTranslations[rawVal][lang]) || rawVal;
            opt.textContent = `${{transName}} (${{count}})`;
          }}
        }});
      }}

      const storeFilter = document.getElementById('storeFilter');
      if (storeFilter) {{
        storeFilter.options[0].textContent = translations[lang].val_all;
      }}
      const versionFilter = document.getElementById('versionFilter');
      if (versionFilter) {{
        versionFilter.options[0].textContent = translations[lang].val_all;
      }}
      const sentimentFilter = document.getElementById('sentimentFilter');
      if (sentimentFilter) {{
        sentimentFilter.options[0].textContent = translations[lang].val_all;
        sentimentFilter.options[1].textContent = sentimentTranslations["Tích cực"][lang];
        sentimentFilter.options[2].textContent = sentimentTranslations["Tiêu cực"][lang];
        sentimentFilter.options[3].textContent = sentimentTranslations["Hỗn hợp"][lang];
        sentimentFilter.options[4].textContent = sentimentTranslations["Trung lập"][lang];
      }}

      // Translate Chart Elements
      updateChartsLanguage(lang);

      // Re-render Review Explorer
      renderTable();

      // Original language note
      const originalNote = document.getElementById('originalNote');
      if (originalNote) {{
        originalNote.textContent = translations[lang].original_note;
      }}

      // Save preference
      localStorage.setItem('report_lang', lang);
    }}

    // Switch lang buttons events
    document.querySelectorAll('.lang-btn').forEach(btn => {{
      btn.addEventListener('click', () => {{
        setLanguage(btn.getAttribute('data-lang'));
      }});
    }});
    
    // Theme switching integration
    themeToggleBtn.addEventListener('click', () => {{
      document.body.classList.toggle('dark');
      const isDark = document.body.classList.contains('dark');
      if (isDark) {{
        themeToggleIcon.textContent = '☀️';
        themeToggleText.textContent = translations[currentLang].theme_light;
        localStorage.setItem('theme', 'dark');
      }} else {{
        themeToggleIcon.textContent = '🌙';
        themeToggleText.textContent = translations[currentLang].theme_dark;
        localStorage.setItem('theme', 'light');
      }}
      updateChartsTheme(isDark);
    }});

    // Load stored theme on load
    if (localStorage.getItem('theme') === 'dark') {{
      document.body.classList.add('dark');
      themeToggleIcon.textContent = '☀️';
      themeToggleText.textContent = translations[currentLang].theme_light;
    }}

    // 4. Render Chart.js
    let sentimentChartObj, ratingChartObj;
    
    function initCharts(isDark) {{
      const textColor = isDark ? '#f8fafc' : '#0f172a';
      const gridColor = isDark ? '#334155' : '#e2e8f0';

      // 4.1 Sentiment Chart
      const sentimentCtx = document.getElementById('sentimentChart').getContext('2d');
      const segmentsKeys = ["Version 2 (03/03 - 27/04)", "Version 3 (28/04 - Present)"];
      
      const posData = segmentsKeys.map(k => sentimentDist["ALL"][k]["Tích cực"]);
      const negData = segmentsKeys.map(k => sentimentDist["ALL"][k]["Tiêu cực"]);
      const mixData = segmentsKeys.map(k => sentimentDist["ALL"][k]["Hỗn hợp"]);
      const neuData = segmentsKeys.map(k => sentimentDist["ALL"][k]["Trung lập"]);

      sentimentChartObj = new Chart(sentimentCtx, {{
        type: 'bar',
        data: {{
          labels: ['Version 2 (03/03 - 27/04)', 'Version 3 (28/04 - Present)'],
          datasets: [
            {{ label: sentimentTranslations["Tích cực"][currentLang], data: posData, backgroundColor: '#2ecc71' }},
            {{ label: sentimentTranslations["Tiêu cực"][currentLang], data: negData, backgroundColor: '#e74c3c' }},
            {{ label: sentimentTranslations["Hỗn hợp"][currentLang], data: mixData, backgroundColor: '#f1c40f' }},
            {{ label: sentimentTranslations["Trung lập"][currentLang], data: neuData, backgroundColor: '#95a5a6' }}
          ]
        }},
        options: {{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {{
            legend: {{ labels: {{ color: textColor }} }}
          }},
          scales: {{
            x: {{ ticks: {{ color: textColor }}, grid: {{ display: false }} }},
            y: {{ ticks: {{ color: textColor }}, grid: {{ color: gridColor }} }}
          }}
        }}
      }});

      // 4.2 Rating Distribution Chart
      const ratingCtx = document.getElementById('ratingChart').getContext('2d');
      const starLabel = currentLang === 'vi' ? 'Sao' : (currentLang === 'zh' ? '星' : 'Star');
      const ratings = ['1', '2', '3', '4', '5'].map(r => `${{r}} ${{starLabel}}`);
      const gpRatingData = [1, 2, 3, 4, 5].map(r => ratingDist["Google Play"][r] || 0);
      const asRatingData = [1, 2, 3, 4, 5].map(r => ratingDist["App Store"][r] || 0);

      ratingChartObj = new Chart(ratingCtx, {{
        type: 'bar',
        data: {{
          labels: ratings,
          datasets: [
            {{ label: 'Google Play', data: gpRatingData, backgroundColor: '#0f9d58' }},
            {{ label: 'App Store', data: asRatingData, backgroundColor: '#8e44ad' }}
          ]
        }},
        options: {{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {{
            legend: {{ labels: {{ color: textColor }} }}
          }},
          scales: {{
            x: {{ ticks: {{ color: textColor }}, grid: {{ display: false }} }},
            y: {{ ticks: {{ color: textColor }}, grid: {{ color: gridColor }} }}
          }}
        }}
      }});
    }}

    function updateChartsTheme(isDark) {{
      const textColor = isDark ? '#f8fafc' : '#0f172a';
      const gridColor = isDark ? '#334155' : '#e2e8f0';

      [sentimentChartObj, ratingChartObj].forEach(chart => {{
        if (chart) {{
          chart.options.plugins.legend.labels.color = textColor;
          chart.options.scales.x.ticks.color = textColor;
          chart.options.scales.y.ticks.color = textColor;
          chart.options.scales.y.grid.color = gridColor;
          chart.update();
        }}
      }});
    }}

    function updateChartsLanguage(lang) {{
      if (sentimentChartObj) {{
        sentimentChartObj.data.datasets[0].label = sentimentTranslations["Tích cực"][lang];
        sentimentChartObj.data.datasets[1].label = sentimentTranslations["Tiêu cực"][lang];
        sentimentChartObj.data.datasets[2].label = sentimentTranslations["Hỗn hợp"][lang];
        sentimentChartObj.data.datasets[3].label = sentimentTranslations["Trung lập"][lang];
        sentimentChartObj.update();
      }}
      if (ratingChartObj) {{
        const starLabel = lang === 'vi' ? 'Sao' : (lang === 'zh' ? '星' : 'Star');
        ratingChartObj.data.labels = ['1', '2', '3', '4', '5'].map(r => `${{r}} ${{starLabel}}`);
        ratingChartObj.update();
      }}
    }}

    initCharts(document.body.classList.contains('dark'));

    // Chart tabs switching logic
    const chartTabs = document.querySelectorAll('.btn-chart-tab');
    chartTabs.forEach(tab => {{
      tab.addEventListener('click', () => {{
        chartTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const storeKey = tab.getAttribute('data-store');
        
        const segmentsKeys = ["Version 2 (03/03 - 27/04)", "Version 3 (28/04 - Present)"];
        const posData = segmentsKeys.map(k => sentimentDist[storeKey][k]["Tích cực"] || 0);
        const negData = segmentsKeys.map(k => sentimentDist[storeKey][k]["Tiêu cực"] || 0);
        const mixData = segmentsKeys.map(k => sentimentDist[storeKey][k]["Hỗn hợp"] || 0);
        const neuData = segmentsKeys.map(k => sentimentDist[storeKey][k]["Trung lập"] || 0);
        
        sentimentChartObj.data.datasets[0].data = posData;
        sentimentChartObj.data.datasets[1].data = negData;
        sentimentChartObj.data.datasets[2].data = mixData;
        sentimentChartObj.data.datasets[3].data = neuData;
        sentimentChartObj.update();
      }});
    }});

    // 5. Explorer Search & Filtering + Pagination in Vanilla JS
    let filteredReviews = [...rawReviews];
    let currentPage = 1;
    const pageSize = 50;

    const searchInput = document.getElementById('searchInput');
    const storeFilter = document.getElementById('storeFilter');
    const versionFilter = document.getElementById('versionFilter');
    const sentimentFilter = document.getElementById('sentimentFilter');
    const categoryFilter = document.getElementById('categoryFilter');

    const reviewsTableBody = document.getElementById('reviewsTableBody');
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');

    function filterData() {{
      const searchVal = searchInput.value.toLowerCase().trim();
      const storeVal = storeFilter.value;
      const versionVal = versionFilter.value;
      const sentimentVal = sentimentFilter.value;
      const categoryVal = categoryFilter.value;

      filteredReviews = rawReviews.filter(r => {{
        const matchText = !searchVal || 
                          r.content.toLowerCase().includes(searchVal) || 
                          r.author.toLowerCase().includes(searchVal);
                          
        const matchStore = storeVal === 'all' || r.Store === storeVal;
        const matchVersion = versionVal === 'all' || r['Version Segment'] === versionVal;
        const matchSentiment = sentimentVal === 'all' || r.sentiment === sentimentVal;
        
        const matchCategory = categoryVal === 'all' || 
                              r.category.split(', ').map(c => c.trim()).includes(categoryVal);

        return matchText && matchStore && matchVersion && matchSentiment && matchCategory;
      }});

      currentPage = 1;
      renderTable();
    }}

    function translateComment(text, cell, btn) {{
      const existingTranslation = cell.querySelector('.translated-comment-box');
      if (existingTranslation) {{
        if (existingTranslation.style.display === 'none') {{
          existingTranslation.style.display = 'block';
          btn.textContent = currentLang === 'en' ? '[Show Original]' : '[显示原文]';
        }} else {{
          existingTranslation.style.display = 'none';
          btn.textContent = currentLang === 'en' ? '[Translate]' : '[翻译]';
        }}
        return;
      }}
      
      btn.textContent = currentLang === 'en' ? '[Translating...]' : '[翻译中...]';
      
      const targetLang = currentLang === 'zh' ? 'zh-CN' : 'en';
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=vi&tl=${{targetLang}}&dt=t&q=${{encodeURIComponent(text)}}`;
      
      fetch(url)
        .then(res => res.json())
        .then(data => {{
          if (data && data[0]) {{
            const translatedText = data[0].map(x => x[0]).join('');
            
            const transBox = document.createElement('div');
            transBox.className = 'translated-comment-box';
            transBox.style.fontStyle = 'italic';
            transBox.style.marginTop = '6px';
            transBox.style.paddingTop = '6px';
            transBox.style.borderTop = '1px dashed var(--border-color)';
            transBox.style.color = 'var(--text-secondary)';
            transBox.innerHTML = `<strong>${{currentLang === 'en' ? 'Translation' : '翻译'}}:</strong> ${{translatedText}}`;
            
            cell.appendChild(transBox);
            btn.textContent = currentLang === 'en' ? '[Show Original]' : '[显示原文]';
          }} else {{
            btn.textContent = currentLang === 'en' ? '[Translation Error]' : '[翻译失败]';
          }}
        }})
        .catch(err => {{
          console.error(err);
          btn.textContent = currentLang === 'en' ? '[Error]' : '[出错了]';
        }});
    }}

    function renderTable() {{
      reviewsTableBody.innerHTML = '';
      
      const totalFiltered = filteredReviews.length;
      const totalPages = Math.ceil(totalFiltered / pageSize);
      
      if (totalFiltered === 0) {{
        reviewsTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 40px; color: var(--text-secondary);">${{translations[currentLang].exp_empty}}</td></tr>`;
        paginationInfo.textContent = translations[currentLang].exp_pagination
          .replace('{{start}}', 0)
          .replace('{{end}}', 0)
          .replace('{{total}}', 0);
        prevPageBtn.disabled = true;
        nextPageBtn.disabled = true;
        return;
      }}

      const startIndex = (currentPage - 1) * pageSize;
      const endIndex = Math.min(startIndex + pageSize, totalFiltered);
      const pageReviews = filteredReviews.slice(startIndex, endIndex);

      pageReviews.forEach(r => {{
        const row = document.createElement('tr');
        
        const dateCell = document.createElement('td');
        dateCell.textContent = r.at;
        
        const storeCell = document.createElement('td');
        const storeBadge = document.createElement('span');
        storeBadge.className = 'badge ' + (r.Store === 'Google Play' ? 'store-gp' : 'store-as');
        storeBadge.textContent = r.Store;
        storeCell.appendChild(storeBadge);
        
        const ratingCell = document.createElement('td');
        ratingCell.className = 'stars-cell';
        ratingCell.textContent = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
        
        const sentimentCell = document.createElement('td');
        const sentBadge = document.createElement('span');
        let sentClass = 'neu';
        if (r.sentiment === 'Tích cực') sentClass = 'pos';
        else if (r.sentiment === 'Tiêu cực') sentClass = 'neg';
        else if (r.sentiment === 'Hỗn hợp') sentClass = 'mix';
        sentBadge.className = 'badge ' + sentClass;
        sentBadge.textContent = sentimentTranslations[r.sentiment] ? sentimentTranslations[r.sentiment][currentLang] : r.sentiment;
        sentimentCell.appendChild(sentBadge);
        
        const catCell = document.createElement('td');
        catCell.textContent = translateCategoryList(r.category, currentLang);
        
        const contentCell = document.createElement('td');
        contentCell.className = 'content-cell';
        
        const contentWrapper = document.createElement('div');
        contentWrapper.innerHTML = `<strong>${{r.author}}:</strong> <span class="comment-body">${{r.content}}</span>`;
        contentCell.appendChild(contentWrapper);
        
        if (currentLang !== 'vi') {{
          const transBtn = document.createElement('span');
          transBtn.className = 'translate-comment-btn';
          transBtn.style.fontSize = '0.75rem';
          transBtn.style.color = 'var(--primary-color)';
          transBtn.style.cursor = 'pointer';
          transBtn.style.marginLeft = '8px';
          transBtn.style.textDecoration = 'underline';
          transBtn.style.display = 'inline-block';
          transBtn.textContent = currentLang === 'en' ? '[Translate]' : '[翻译]';
          
          transBtn.addEventListener('click', () => {{
            translateComment(r.content, contentCell, transBtn);
          }});
          contentWrapper.appendChild(transBtn);
        }}

        row.appendChild(dateCell);
        row.appendChild(storeCell);
        row.appendChild(ratingCell);
        row.appendChild(sentimentCell);
        row.appendChild(catCell);
        row.appendChild(contentCell);
        
        reviewsTableBody.appendChild(row);
      }});

      paginationInfo.textContent = translations[currentLang].exp_pagination
        .replace('{{start}}', startIndex + 1)
        .replace('{{end}}', endIndex)
        .replace('{{total}}', totalFiltered);
      prevPageBtn.disabled = currentPage === 1;
      nextPageBtn.disabled = currentPage === totalPages || totalPages === 0;
      prevPageBtn.textContent = translations[currentLang].btn_prev;
      nextPageBtn.textContent = translations[currentLang].btn_next;
    }}

    // Event Listeners for Filters
    [searchInput, storeFilter, versionFilter, sentimentFilter, categoryFilter].forEach(el => {{
      el.addEventListener('input', filterData);
    }});

    // Pagination events
    prevPageBtn.addEventListener('click', () => {{
      if (currentPage > 1) {{
        currentPage--;
        renderTable();
      }}
    }});

    nextPageBtn.addEventListener('click', () => {{
      const totalFiltered = filteredReviews.length;
      const totalPages = Math.ceil(totalFiltered / pageSize);
      if (currentPage < totalPages) {{
        currentPage++;
        renderTable();
      }}
    }});

    // Set initial language from storage if present
    const savedLang = localStorage.getItem('report_lang');
    if (savedLang && ['vi', 'en', 'zh'].includes(savedLang)) {{
      setLanguage(savedLang);
    }} else {{
      setLanguage('vi');
    }}

  </script>
  
  <footer style="text-align: center; margin-top: 50px; padding: 20px; font-size: 0.85rem; color: var(--text-secondary); border-top: 1px solid var(--border-color);">
    GS9-CFL Team-VinhVNN-26/05/2026
  </footer>
</body>
</html>
"""
    
    log.info(f"Writing HTML report to: {output_html_path}")
    with open(output_html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
        
    log.info("✅ HTML Report generation complete!")

if __name__ == "__main__":
    main()
