export type RatingDistribution = Record<string, number>;

export type StorePlatformBreakdown = {
  store: string;
  count: number;
  avg_rating: number;
};

export type StoreHighlight = {
  key: string;
  label: string;
  value: string;
  tone: "neutral" | "negative" | "positive" | "warning";
};

export type StoreBreakdownSummary = {
  avg_rating: number | null;
  rating_count: number;
  low_rating_count: number;
  low_rating_pct: number;
  high_rating_count: number;
  high_rating_pct: number;
  lowest_platform: StorePlatformBreakdown | null;
  highlights: StoreHighlight[];
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(part: number, total: number) {
  return total ? round((part / total) * 100, 1) : 0;
}

function formatPercent(value: number) {
  return Number.isInteger(value) ? String(value) : String(value);
}

function platformLabel(store: string) {
  if (store === "gp") return "Google Play";
  if (store === "ios") return "App Store";
  return store || "unknown";
}

export function summarizeStoreBreakdown(
  ratingDistribution: RatingDistribution,
  platforms: StorePlatformBreakdown[]
): StoreBreakdownSummary {
  let ratingCount = 0;
  let ratingTotal = 0;

  for (const [star, count] of Object.entries(ratingDistribution)) {
    const rating = Number(star);
    const safeCount = Number(count || 0);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5 || safeCount <= 0) continue;
    ratingCount += safeCount;
    ratingTotal += rating * safeCount;
  }

  const lowRatingCount = Number(ratingDistribution["1"] || 0) + Number(ratingDistribution["2"] || 0);
  const highRatingCount = Number(ratingDistribution["4"] || 0) + Number(ratingDistribution["5"] || 0);
  const avgRating = ratingCount ? round(ratingTotal / ratingCount, 2) : null;
  const lowestPlatform = platforms
    .filter((platform) => platform.count > 0 && Number.isFinite(platform.avg_rating))
    .sort((a, b) => a.avg_rating - b.avg_rating)[0] || null;

  const lowRatingPct = pct(lowRatingCount, ratingCount);
  const highRatingPct = pct(highRatingCount, ratingCount);

  const highlights: StoreHighlight[] = [];
  if (avgRating !== null) {
    highlights.push({ key: "avg_rating", label: "Điểm trung bình", value: `${avgRating}/5`, tone: "neutral" });
    highlights.push({
      key: "low_ratings",
      label: "Review 1-2 sao",
      value: `${lowRatingCount} (${formatPercent(lowRatingPct)}%)`,
      tone: "negative",
    });
    highlights.push({
      key: "high_ratings",
      label: "Review 4-5 sao",
      value: `${highRatingCount} (${formatPercent(highRatingPct)}%)`,
      tone: "positive",
    });
  }
  if (lowestPlatform) {
    highlights.push({
      key: "lowest_platform",
      label: "Nền tảng cần chú ý",
      value: `${platformLabel(lowestPlatform.store)} ${lowestPlatform.avg_rating}/5`,
      tone: "warning",
    });
  }

  return {
    avg_rating: avgRating,
    rating_count: ratingCount,
    low_rating_count: lowRatingCount,
    low_rating_pct: lowRatingPct,
    high_rating_count: highRatingCount,
    high_rating_pct: highRatingPct,
    lowest_platform: lowestPlatform,
    highlights,
  };
}
