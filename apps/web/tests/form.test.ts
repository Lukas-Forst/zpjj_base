import { expect, it } from "vitest";
import { DEFAULT_FORM, fromPreset, sanitize, toConfig } from "@/lib/timer/form";

it("clamps to limits: rounds 1..99, times up to 99:59, pause may be 0", () => {
  const f = sanitize({ ...DEFAULT_FORM, rounds: 500, work: 99999, rest: -4, prep: NaN, duration: 0 });
  expect(f).toMatchObject({ rounds: 99, work: 5999, rest: 0, prep: 0, duration: 1 });
});

it("builds mode specific configs", () => {
  expect(toConfig({ ...DEFAULT_FORM, mode: "stopwatch" })).toEqual({ mode: "stopwatch" });
  expect(toConfig({ ...DEFAULT_FORM, mode: "countdown" })).toEqual({ mode: "countdown", duration: 300 });
});

it("fromPreset tolerates garbage", () => {
  expect(fromPreset({ mode: "wat", config: { rounds: "x", work: 20 } })).toMatchObject({ mode: "rounds", rounds: 5, work: 20 });
});

it("presetBody matches the API contract: mode at top level, not inside config", async () => {
  const { presetBody } = await import("@/lib/timer/form");
  expect(presetBody({ ...DEFAULT_FORM })).toEqual({ mode: "rounds", config: { rounds: 5, work: 300, rest: 30, prep: 10 } });
  expect(presetBody({ ...DEFAULT_FORM, mode: "stopwatch" })).toEqual({ mode: "stopwatch", config: {} });
  expect(presetBody({ ...DEFAULT_FORM, mode: "countdown" })).toEqual({ mode: "countdown", config: { duration: 300 } });
});
