import { expect, it } from "vitest";
import { fmt } from "@/lib/timer/fmt";
import { isoWeekday } from "@/lib/format";

it("formats mm:ss with ceil for countdown and floor for stopwatch", () => {
  expect(fmt(0)).toBe("00:00");
  expect(fmt(1)).toBe("00:01");
  expect(fmt(59_000)).toBe("00:59");
  expect(fmt(5999_000)).toBe("99:59");
  expect(fmt(1500, false)).toBe("00:01");
  expect(fmt(3_600_000, false)).toBe("60:00");
  expect(fmt(-5)).toBe("00:00");
});

it("isoWeekday maps date strings to 1..7", () => {
  expect(isoWeekday("2026-11-09")).toBe(1);
  expect(isoWeekday("2026-11-15")).toBe(7);
});
