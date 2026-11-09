import { expect, it } from "vitest";
import { fmt } from "@/lib/timer/fmt";

it("formats mm:ss with ceil for countdown and floor for stopwatch", () => {
  expect(fmt(0)).toBe("00:00");
  expect(fmt(1)).toBe("00:01");
  expect(fmt(59_000)).toBe("00:59");
  expect(fmt(5999_000)).toBe("99:59");
  expect(fmt(1500, false)).toBe("00:01");
  expect(fmt(3_600_000, false)).toBe("60:00");
  expect(fmt(-5)).toBe("00:00");
});
