import { describe, expect, test } from "vitest";
import { classifyFallback } from "./fallback";

function classify(message: string, rating: number | null = null) {
  return classifyFallback({ id: 1, message, rating });
}

describe("classifyFallback topic keywords", () => {
  test("routes common Vietnamese game feedback into the right major topic", () => {
    expect(classify("Ping cao, mạng lag rồi dis khỏi trận liên tục").topic_main).toBe("ping_network");
    expect(classify("Nạp kim cương bị trừ tiền mà chưa nhận gói").topic_main).toBe("payment_topup");
    expect(classify("Hack wall aim bắn xuyên map quá nhiều").topic_main).toBe("hack_cheat");
    expect(classify("Đặt bom bị lỗi, gỡ bom không ăn nút").topic_main).toBe("gameplay");
  });

  test("keeps feature/function complaints out of generic bug buckets", () => {
    const result = classify("Nút đổi súng trong kho đồ không hoạt động, bấm không phản hồi");

    expect(result.topic_main).toBe("function");
    expect(result.sentiment).toBe("negative");
  });
});
