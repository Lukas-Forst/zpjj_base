import { expect, it } from "vitest";
import { computeGaps, isoWeek, slotStatus } from "../src/coverage";

const TODAY = "2026-11-09"; // Montag
const DI = "2026-11-10";
const u = (id: number, active = true, is_trainer = true) => ({ id, display_name: `u${id}`, active, is_trainer });
const slot = (trainers: ReturnType<typeof u>[], o: { weekday?: number; kind?: string; active?: boolean; id?: number; start_time?: string } = {}) =>
  ({ id: o.id ?? 1, weekday: o.weekday ?? 2, kind: o.kind ?? "no_gi", active: o.active ?? true, trainers, start_time: o.start_time ?? "18:00:00" });
const vac = (user_id: number, start_date: string, end_date: string) => ({ user_id, start_date, end_date });
const sub = (slot_id: number, date: string, user_id: number) => ({ slot_id, date, user_id });

it("all trainers absent is unbesetzt (test_all_trainers_absent_is_unbesetzt)", () => {
  const g = computeGaps([slot([u(1), u(2)])], [vac(1, DI, DI), vac(2, DI, DI)], [], TODAY);
  expect(g.map((x) => [x.date, x.level, x.absent_user_ids])).toEqual([[DI, "unbesetzt", [1, 2]]]);
});
it("one of two is teilweise (test_one_of_two_is_teilweise)", () => {
  expect(computeGaps([slot([u(1), u(2)])], [vac(1, DI, DI)], [], TODAY).map((x) => x.level)).toEqual(["teilweise"]);
});
it("substitute makes besetzt (test_substitute_makes_besetzt)", () => {
  const s = [sub(1, DI, 3)];
  expect(computeGaps([slot([u(1), u(2)])], [vac(1, DI, DI), vac(2, DI, DI)], s, TODAY)).toEqual([]);
  expect(computeGaps([slot([u(1)])], [vac(1, DI, DI)], s, TODAY)).toEqual([]);
});
it("open mat never checked (test_open_mat_never_checked)", () => {
  expect(computeGaps([slot([u(1)], { kind: "open_mat" })], [vac(1, DI, DI)], [], TODAY)).toEqual([]);
  expect(slotStatus(slot([u(1)], { kind: "open_mat" }), DI, new Set([1]), [])).toEqual({ status: "nicht_geprueft", absent: [] });
});
it("slot without trainers never checked (test_slot_without_trainers_never_checked)", () => {
  expect(computeGaps([slot([])], [], [], TODAY)).toEqual([]);
});
it("inactive trainer ignored (test_inactive_trainer_ignored)", () => {
  expect(computeGaps([slot([u(1, false), u(2, true, false)])], [vac(1, DI, DI), vac(2, DI, DI)], [], TODAY)).toEqual([]);
});
it("inactive slot ignored (test_inactive_slot_ignored)", () => {
  expect(computeGaps([slot([u(1)], { active: false })], [vac(1, DI, DI)], [], TODAY)).toEqual([]);
});
it("year boundary (test_year_boundary)", () => {
  const g = computeGaps([slot([u(1)], { weekday: 5 })], [vac(1, "2026-12-30", "2027-01-02")], [], "2026-12-29");
  expect(g.map((x) => [x.date, x.level])).toEqual([["2027-01-01", "unbesetzt"]]);
});
it("single day (test_single_day)", () => {
  expect(computeGaps([slot([u(1)])], [vac(1, DI, DI)], [], TODAY)).toHaveLength(1);
});
it("window is 28 days (test_window_is_28_days)", () => {
  const mo = slot([u(1)], { weekday: 1 });
  expect(computeGaps([mo], [vac(1, "2026-12-07", "2026-12-07")], [], TODAY)).toEqual([]);
  expect(computeGaps([mo], [vac(1, "2026-11-30", "2026-11-30")], [], TODAY)).toHaveLength(1);
});
it("substitute on vacation does not count (test_substitute_who_is_on_vacation_does_not_count)", () => {
  const g = computeGaps([slot([u(1)])], [vac(1, DI, DI), vac(3, DI, DI)], [sub(1, DI, 3)], TODAY);
  expect(g.map((x) => x.level)).toEqual(["unbesetzt"]);
});
it("gaps sorted by date then start time", () => {
  const g = computeGaps(
    [slot([u(1)], { id: 1, start_time: "20:00:00" }), slot([u(1)], { id: 2, start_time: "18:00:00" })],
    [vac(1, DI, DI)], [], TODAY);
  expect(g.map((x) => x.slot_id)).toEqual([2, 1]);
});
it("iso week across the year change", () => {
  expect([isoWeek("2026-12-28"), isoWeek("2027-01-04"), isoWeek("2024-12-30"), isoWeek("2026-11-09")]).toEqual([53, 1, 1, 46]);
});
