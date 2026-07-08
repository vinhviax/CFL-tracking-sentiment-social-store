export function parseTopicKeys(value?: string | null) {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const raw of String(value || "").split(",")) {
    const key = raw.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= 30) break;
  }
  return keys;
}

export function normalizeTopicParam(value?: string | null) {
  return parseTopicKeys(value).join(",");
}

export function addTopicFilter(where: string[], params: any[], value?: string | null, alias = "a") {
  const keys = parseTopicKeys(value);
  if (!keys.length) return keys;
  const column = `${alias}.topic_main`;
  if (keys.length === 1) {
    where.push(`${column} = ?`);
  } else {
    where.push(`${column} IN (${keys.map(() => "?").join(",")})`);
  }
  params.push(...keys);
  return keys;
}

export function topicFilenamePart(value?: string | null) {
  const keys = parseTopicKeys(value);
  if (keys.length <= 1) return keys[0] || "";
  return `topics-${keys.length}`;
}
