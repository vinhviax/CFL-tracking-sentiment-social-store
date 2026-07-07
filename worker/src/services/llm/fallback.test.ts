import { describe, expect, test } from "vitest";
import { classifyFallback } from "./fallback";

function classify(message: string, rating: number | null = null) {
  return classifyFallback({ id: 1, message, rating });
}

describe("classifyFallback topic keywords", () => {
  test("separates lag, crash, and network delay into distinct major topics", () => {
    expect(classify("Máy yếu tụt fps, combat giật khựng không mượt").topic_main).toBe("lag_fps");
    expect(classify("Đang chơi tự nhiên văng game, app tự thoát ra màn hình chính").topic_main).toBe("crash_freeze");
    expect(classify("Ping cao mạng yếu delay rồi dis khỏi trận liên tục").topic_main).toBe("network_ping");
  });

  test("routes common Vietnamese game feedback into the right major topic", () => {
    expect(classify("Ping cao, mạng yếu rồi dis khỏi trận liên tục").topic_main).toBe("network_ping");
    expect(classify("Nạp kim cương bị trừ tiền mà chưa nhận gói").topic_main).toBe("payment_topup");
    expect(classify("Hack wall aim bắn xuyên map quá nhiều").topic_main).toBe("hack_cheat");
    expect(classify("Đặt bom bị lỗi, gỡ bom không ăn nút").topic_main).toBe("gameplay_mode_map");
  });

  test("keeps UI/control complaints out of generic technical buckets", () => {
    const result = classify("Nút đổi súng trong kho đồ không hoạt động, bấm không phản hồi");

    expect(result.topic_main).toBe("ui_control");
    expect(result.sentiment).toBe("negative");
  });

  test("routes mentions of CFM, China, or SEA game versions into game comparison", () => {
    expect(classify("CFM SEA muot hon ban Viet nhieu").topic_main).toBe("game_comparison");
    expect(classify("Ban Trung nhieu sung hon CFL VN").topic_main).toBe("game_comparison");
    expect(classify("Game China event ngon hon game nay").topic_main).toBe("game_comparison");
    expect(classify("SEA event ngon hon game nay").topic_main).toBe("game_comparison");
  });
});
