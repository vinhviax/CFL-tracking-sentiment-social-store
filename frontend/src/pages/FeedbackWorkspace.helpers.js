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
