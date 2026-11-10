import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { addDays, isoWeekday, todayBerlin } from "../src/dates";
import { monthsAgo } from "../src/stats";
import { addSlot, addUser, call, resetDb } from "./helpers";

const EMAIL = "t@example.com";
const mk = (d: string, o: { total?: number | null; cancelled?: boolean; open_mat?: number | null } = {}) =>
  env.DB.prepare("INSERT INTO attendance (date, cancelled, total, open_mat, updated_at) VALUES (?,?,?,?,'x')")
    .bind(d, o.cancelled ? 1 : 0, o.total ?? null, o.open_mat ?? null).run();
const monday = (d: string) => addDays(d, -(isoWeekday(d) - 1));
const get = (p: string, as: string | null = EMAIL) => call(p, { as: as ?? undefined });
beforeEach(async () => {
  await resetDb();
  await addUser({ email: EMAIL });
  for (const wd of [2, 3, 4, 5, 6, 7]) await addSlot({ weekday: wd, start_time: "18:00:00", end_time: "20:00:00", kind: "gi" });
});

it("monthsAgo clamps (test_months_ago_clamps)", () => {
  expect(monthsAgo("2026-05-31", 3)).toBe("2026-02-28");
  expect(monthsAgo("2026-03-15", 2)).toBe("2026-01-15");
  expect(monthsAgo("2026-01-31", 2)).toBe("2025-11-30");
});
it("monthsAgo leap day and year boundary (new)", () => {
  expect(monthsAgo("2024-05-31", 3)).toBe("2024-02-29");
  expect(monthsAgo("2024-02-29", 3)).toBe("2023-11-29");
  expect(monthsAgo("2025-05-29", 3)).toBe("2025-02-28");
  expect(monthsAgo("2026-02-28", 3)).toBe("2025-11-28");
  expect(monthsAgo("2026-01-10", 2)).toBe("2025-11-10");
});
it("weeks shape and gap (test_weeks_shape_and_gap)", async () => {
  await mk(addDays(monday(todayBerlin()), -(7 * 3 - 1)), { total: 10 }); // Sunday, 3 weeks back
  const j = (await (await get("/api/attendance/stats")).json()) as any;
  expect(j.months).toBe(3);
  const w = j.weeks;
  expect(w).toHaveLength(12);
  expect(w.map((x: any) => x.week_start)).toEqual(w.map((x: any) => x.week_start).sort());
  expect(w.at(-1).week_start).toBe(monday(todayBerlin()));
  expect(w.at(-1)).toEqual({ week_start: monday(todayBerlin()), avg: null, days: 0 });
  expect(w.at(-4)).toMatchObject({ avg: 10.0, days: 1 });
  expect(j.weekday_avg).toHaveLength(7);
  expect(j.weekday_avg.map((x: any) => x.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
});
it("weeks exclude openmat cancelled and null total (test_weeks_exclude_openmat_cancelled_and_null_total)", async () => {
  const m = addDays(monday(todayBerlin()), -14);
  await mk(addDays(m, 1), { total: 10 });
  await mk(addDays(m, 2), { total: 5 });
  await mk(addDays(m, 3), { cancelled: true });
  await mk(addDays(m, 6), { total: null, open_mat: 9 });
  await mk(addDays(m, 4), { total: null });
  const j = (await (await get("/api/attendance/stats")).json()) as any;
  expect(j.weeks.at(-3).avg).toBe(7.5);
  expect(j.weeks.at(-3).days).toBe(2);
  expect(j.weekday_avg[6].avg).toBeNull();
});
it("weekday window 2 vs 3 months (test_weekday_window_2_vs_3_months)", async () => {
  const d = addDays(todayBerlin(), -80);
  await mk(d, { total: 12 });
  const wd = isoWeekday(d) - 1;
  expect(((await (await get("/api/attendance/stats?months=2")).json()) as any).weekday_avg[wd].avg).toBeNull();
  expect(((await (await get("/api/attendance/stats?months=3")).json()) as any).weekday_avg[wd].avg).toBe(12.0);
});
it("weekday window start is inclusive (new)", async () => {
  const start = monthsAgo(todayBerlin(), 2);
  await mk(start, { total: 7 });
  await mk(addDays(start, -1), { total: 100 });
  const j = (await (await get("/api/attendance/stats?months=2")).json()) as any;
  expect(j.weekday_avg[isoWeekday(start) - 1].avg).toBe(7.0);
});
it("months validation (test_months_validation)", async () => {
  for (const q of ["4", "1", "x"]) {
    const r = await get(`/api/attendance/stats?months=${q}`);
    expect(r.status).toBe(422);
    expect(typeof ((await r.json()) as any).detail).toBe("string");
  }
});
it("stats requires login (test_stats_requires_login)", async () => {
  expect((await get("/api/attendance/stats", null)).status).toBe(401);
});
it("stats/missing are not swallowed by /:day (new)", async () => {
  expect((await get("/api/attendance/stats")).status).toBe(200);
  expect((await get("/api/attendance/missing")).status).toBe(200);
});
