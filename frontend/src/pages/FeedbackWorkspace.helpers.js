export function applyWorkspaceFilter(current, key, value) {
  if (key === "sentiment") {
    return { ...current, sentiment: value, topic: "", subtopic: "" };
  }
  if (key === "topic") {
    return { ...current, topic: value, subtopic: "" };
  }
  return { ...current, [key]: value };
}

export function buildTopicOptions(topicLabels = {}, ranking = [], options = {}) {
  const includeEmpty = options.includeEmpty !== false;
  const seen = new Set();
  const topicOptions = [];

  for (const item of ranking) {
    if (!item?.topic || seen.has(item.topic)) continue;
    seen.add(item.topic);
    topicOptions.push({
      key: item.topic,
      label: item.label || topicLabels[item.topic] || item.topic,
      count: Number(item.count || 0),
    });
  }

  if (!includeEmpty) return topicOptions;

  for (const [key, label] of Object.entries(topicLabels || {})) {
    if (seen.has(key)) continue;
    topicOptions.push({ key, label, count: 0 });
  }

  return topicOptions;
}

export function isActionableTopic(topic) {
  return Boolean(topic) && topic !== "other";
}

function formatCount(value) {
  return Number(value || 0).toLocaleString("vi-VN");
}

export function buildStoreHighlights(storeBreakdown, ranking, t) {
  const highlights = [...(storeBreakdown?.highlights || [])];
  const actionableRanking = (ranking || []).filter((item) => isActionableTopic(item?.topic));
  const negativeRanking = actionableRanking.filter((item) => Number(item?.negative_count || item?.negative || 0) > 0);
  const topIssue = [...(negativeRanking.length ? negativeRanking : actionableRanking)]
    .sort((a, b) => (
      Number(b?.negative_count || b?.negative || 0) - Number(a?.negative_count || a?.negative || 0)
      || Number(b?.urgent_count || b?.urgent || 0) - Number(a?.urgent_count || a?.urgent || 0)
      || Number(b?.count || 0) - Number(a?.count || 0)
    ))[0];
  if (topIssue) {
    highlights.push({
      key: "top_issue",
      label: t.topIssueInRange,
      value: `${topIssue.label} (${formatCount(topIssue.count)})`,
      tone: "warning",
    });
  }
  return highlights;
}
