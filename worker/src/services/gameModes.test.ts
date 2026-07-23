import { describe, expect, it } from "vitest";
import { GAME_MODES, matchGameModes } from "./gameModes";

describe("matchGameModes", () => {
  it("has 9 curated modes under gameplay_mode_map", () => {
    expect(GAME_MODES).toHaveLength(9);
    for (const mode of GAME_MODES) {
      expect(mode.key.startsWith("gameplay_mode_map:")).toBe(true);
    }
  });

  it("tags C4 kinh tế confidently", () => {
    const m = matchGameModes("mode c4 kinh tế lag quá");
    expect(m.confident).toContain("gameplay_mode_map:c4_kinh_te");
    expect(m.ambiguous).not.toContain("gameplay_mode_map:c4_kinh_te");
  });

  it("tags Zombie v4 confidently", () => {
    const m = matchGameModes("zombie v4 khó chơi");
    expect(m.confident).toContain("gameplay_mode_map:zombie_v4");
  });

  it("tags Zombie Truy Kích confidently", () => {
    const m = matchGameModes("chế độ truy kích hay đấy");
    expect(m.confident).toContain("gameplay_mode_map:zombie_truy_kich");
  });

  it("tags Trốn Tìm confidently", () => {
    const m = matchGameModes("chơi trốn tìm vui");
    expect(m.confident).toContain("gameplay_mode_map:tron_tim");
  });

  it("treats bare 'dao' as ambiguous (knife item vs Đấu Dao mode)", () => {
    const m = matchGameModes("mua con dao mới đẹp quá");
    expect(m.ambiguous).toContain("gameplay_mode_map:dau_dao");
    expect(m.confident).not.toContain("gameplay_mode_map:dau_dao");
  });

  it("tags Đấu Dao confidently when phrase is explicit", () => {
    const m = matchGameModes("mode đấu dao căng thẳng");
    expect(m.confident).toContain("gameplay_mode_map:dau_dao");
    expect(m.ambiguous).not.toContain("gameplay_mode_map:dau_dao");
  });

  it("treats bare 'sniper' as ambiguous", () => {
    const m = matchGameModes("khẩu sniper bắn mạnh");
    expect(m.ambiguous).toContain("gameplay_mode_map:dau_sniper");
  });

  it("returns nothing for unrelated comments", () => {
    const m = matchGameModes("nạp tiền không nhận được kim cương");
    expect(m.confident).toHaveLength(0);
    expect(m.ambiguous).toHaveLength(0);
  });
});
