import { normalizeTopicText } from "./topicKeywords";

// Curated game-mode subtopics that live under the "gameplay_mode_map" parent
// topic ("Chế độ chơi/Map/Gameplay"). Unlike the LLM-discovered subtopics in
// taxonomyMemory, these are a fixed, business-defined list of CFL game modes.
export const GAME_MODE_PARENT_TOPIC = "gameplay_mode_map";

export interface GameMode {
  key: string;
  label_vi: string;
  label_zh_cn: string;
  description: string;
  // Phrases whose presence confidently identifies the mode (tagged directly).
  confident: string[];
  // Phrases that only hint at the mode; hits are sent to the LLM to confirm
  // because the term is also used in unrelated contexts (items, weapons...).
  ambiguous: string[];
}

// Keys mirror normalizeSubtopicKey("gameplay_mode_map", label_vi).
export const GAME_MODES: GameMode[] = [
  {
    key: "gameplay_mode_map:c4_kinh_te",
    label_vi: "C4 Kinh Tế",
    label_zh_cn: "C4经济模式",
    description: "Chế độ đặt bom C4 có kinh tế (mua súng theo tiền trong trận).",
    confident: ["c4 kinh te", "cs kinh te", "che do kinh te", "map kinh te", "kinh te"],
    ambiguous: [],
  },
  {
    key: "gameplay_mode_map:c4_thuong",
    label_vi: "C4 Thường",
    label_zh_cn: "C4常规模式",
    description: "Chế độ đặt bom C4 thường (không kinh tế).",
    confident: ["c4 thuong", "che do c4 thuong", "bom thuong", "c4 co ban"],
    ambiguous: ["c4", "dat bom", "go bom", "che do bom", "danh bom"],
  },
  {
    key: "gameplay_mode_map:zombie_v4",
    label_vi: "Zombie v4",
    label_zh_cn: "僵尸v4",
    description: "Chế độ Zombie phiên bản 4.",
    confident: ["zombie v4", "zb v4", "zombie 4", "zombie ver 4", "zombie version 4", "z4"],
    ambiguous: [],
  },
  {
    key: "gameplay_mode_map:zombie_truy_kich",
    label_vi: "Zombie Truy Kích",
    label_zh_cn: "追击僵尸",
    description: "Chế độ Zombie Truy Kích.",
    confident: ["zombie truy kich", "zb truy kich", "truy kich"],
    ambiguous: [],
  },
  {
    key: "gameplay_mode_map:dau_dao",
    label_vi: "Đấu Dao",
    label_zh_cn: "刀战",
    description: "Chế độ đấu dao (chỉ dùng dao).",
    confident: ["dau dao", "che do dao", "map dao", "danh dao", "choi dao", "solo dao"],
    ambiguous: ["dao"],
  },
  {
    key: "gameplay_mode_map:dau_sniper",
    label_vi: "Đấu Sniper",
    label_zh_cn: "狙击模式",
    description: "Chế độ đấu súng bắn tỉa (sniper).",
    confident: ["dau sniper", "che do sniper", "map sniper", "solo sniper", "danh sniper", "dau ban tia"],
    ambiguous: ["sniper", "awm", "ban tia"],
  },
  {
    key: "gameplay_mode_map:dau_doi",
    label_vi: "Đấu Đội",
    label_zh_cn: "团队竞技",
    description: "Chế độ đấu theo đội (team deathmatch).",
    confident: ["dau doi", "dau team", "danh doi", "team deathmatch"],
    ambiguous: ["tdm"],
  },
  {
    key: "gameplay_mode_map:dau_don",
    label_vi: "Đấu Đơn",
    label_zh_cn: "个人竞技",
    description: "Chế độ đấu cá nhân (solo/free for all).",
    confident: ["dau don", "danh don", "choi don"],
    ambiguous: ["solo", "ffa", "1v1", "free for all"],
  },
  {
    key: "gameplay_mode_map:tron_tim",
    label_vi: "Trốn Tìm",
    label_zh_cn: "捉迷藏",
    description: "Chế độ trốn tìm (ẩn nấp).",
    confident: ["tron tim", "an nap", "hide and seek"],
    ambiguous: [],
  },
];

export const GAME_MODE_BY_KEY = new Map(GAME_MODES.map((mode) => [mode.key, mode]));

function phraseHit(normalizedText: string, phrase: string): boolean {
  const normalizedPhrase = normalizeTopicText(phrase);
  if (!normalizedPhrase) return false;
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

export interface GameModeMatch {
  confident: string[];
  ambiguous: string[];
}

// Match a comment against the curated modes. A mode lands in `confident` when a
// confident phrase hits; otherwise in `ambiguous` when only an ambiguous phrase
// hits. A mode never appears in both lists.
export function matchGameModes(message: string): GameModeMatch {
  const normalized = normalizeTopicText(message || "");
  const confident: string[] = [];
  const ambiguous: string[] = [];
  if (!normalized) return { confident, ambiguous };

  for (const mode of GAME_MODES) {
    if (mode.confident.some((phrase) => phraseHit(normalized, phrase))) {
      confident.push(mode.key);
    } else if (mode.ambiguous.some((phrase) => phraseHit(normalized, phrase))) {
      ambiguous.push(mode.key);
    }
  }
  return { confident, ambiguous };
}
