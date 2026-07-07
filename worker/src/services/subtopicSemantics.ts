import { normalizeTopicText } from "./topicKeywords";

export interface SemanticSubtopic {
  key: string;
  label_vi: string;
  label_zh_cn: string | null;
}

const UPDATE_VERSION_SUBTOPIC: SemanticSubtopic = {
  key: "update_download:cap_nhat_phien_ban_moi",
  label_vi: "Cập nhật/phiên bản mới",
  label_zh_cn: "更新/新版本",
};

function tokensOf(label: string): Set<string> {
  const text = label.includes(":") ? label.split(":").slice(1).join(" ") : label;
  return new Set(normalizeTopicText(text.replace(/_/g, " ")).split(" ").filter(Boolean));
}

export function getSemanticSubtopic(parentTopic: string, labelOrKey: string): SemanticSubtopic | null {
  const tokens = tokensOf(labelOrKey);
  if (parentTopic === "update_download") {
    const hasUpdate = tokens.has("update") || tokens.has("nhat") || (tokens.has("cap") && tokens.has("nhat"));
    const hasVersion = tokens.has("phien") || tokens.has("version") || tokens.has("patch");
    const hasState = tokens.has("moi") || tokens.has("xong") || tokens.has("sau");
    if ((hasUpdate || hasVersion) && (hasState || hasVersion)) return UPDATE_VERSION_SUBTOPIC;
  }
  return null;
}

export function canonicalSubtopicKey(parentTopic: string, label: string): string | null {
  return getSemanticSubtopic(parentTopic, label)?.key || null;
}
