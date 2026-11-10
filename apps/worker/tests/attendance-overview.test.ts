import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { addDays, isoWeekday, todayBerlin } from "../src/dates";
import { addSlot, addUser, call, resetDb } from "./helpers";

const EMAIL = "t@example.com";
const mk = (d: string, o: { total?: number | null; cancelled?: boolean; open_mat?: number | null } = {}) =>
  env.DB.prepare("INSERT INTO attendance (date, cancelled, total, open_mat, updated_at) VALUES (?,?,?,?,'x')")
    .bind(d, o.cancelled ? 1 : 0, o.total ?? null, o.open_mat ?? null).run();
function last(isoday: number, back = 0): string {
  let d = addDays(todayBerlin(), -1);
  while (isoWeekday(d) !== isoday) d = addDays(d, -1);
  return addDays(d, -7 * back);
}
const get = (p: string, as: string | null = EMAIL) => call(p, { as: as ?? undefined });
beforeEach(async () => {
  await resetDb();
  await addUser({ email: EMAIL });
  for (const wd of [2, 3, 4, 5, 6, 7]) await addSlot({ weekday: wd, start_time: "18:00:00", end_time: "20:00:00", kind: "gi" });
});

it("overview averages ignore openmat and cancelled (test_overview_averages_ignore_openmat_and_cancelled)", async () => {
  await mk(last(3), { total: 10 });
  await mk(last(3, 1), { total: 6 });
  await mk(last(3, 2), { cancelled: true });
  await mk(last(7), { total: null, open_mat: 5 });
  const j = (await (await get("/api/attendance")).json()) as any;
  expect(j.avg_by_weekday).toHaveLength(7);
  expect(j.avg_by_weekday[2]).toEqual({ weekday: 3, avg: 8.0 });
  expect(j.avg_by_weekday[6].avg).toBeNull();
  expect(j.entries[0].date).toBe(j.entries.map((e: any) => e.date).sort().at(-1));
});
it("avg_14d window (test_avg_14d_window)", async () => {
  await mk(last(3), { total: 10 });
  await mk(addDays(todayBerlin(), -20), { total: 100 });
  const j = (await (await get("/api/attendance")).json()) as any;
  expect(j.avg_14d).toBe(10.0);
  expect(j.entries).toHaveLength(2);
  expect(((await (await get("/api/attendance?days=10")).json()) as any).entries).toHaveLength(1);
});
it("days validation 1..400 -> 422 with string detail (new)", async () => {
  for (const q of ["0", "401", "x"]) {
    const r = await get(`/api/attendance?days=${q}`);
    expect(r.status).toBe(422);
    expect(typeof ((await r.json()) as any).detail).toBe("string");
  }
  expect((await get("/api/attendance?days=400")).status).toBe(200);
});
it("entries carry names, members and updater (new)", async () => {
  await addUser({ email: "u@example.com", name: "Uwe" });
  const d = last(3);
  expect((await call(`/api/attendance/${d}`, { method: "PUT", as: "u@example.com", json: { total: 10, trial_names: ["Zoe", "Abe"], guests: 1 } })).status).toBe(200);
  const e = ((await (await get("/api/attendance")).json()) as any).entries[0];
  expect(e).toMatchObject({ date: d, names: ["Abe", "Zoe"], members: 7, trials: 2, guests: 1, updated_by_name: "Uwe", cancelled: false });
});
it("averages round to one decimal, half-even like Python round (new)", async () => {
  // 9/4 = 2.25 -> Python round(2.25, 1) == 2.2 (JS Math.round would give 2.3)
  for (const [i, t] of [2, 2, 2, 3].entries()) await mk(last(3, i), { total: t });
  expect(((await (await get("/api/attendance")).json()) as any).avg_by_weekday[2].avg).toBe(2.2);
});
it("missing skips monday and today (test_missing_skips_monday_and_today)", async () => {
  await mk(todayBerlin(), { total: 5 });
  let y = addDays(todayBerlin(), -1);
  if (isoWeekday(y) === 1) y = addDays(y, -1);
  expect(await (await get("/api/attendance/missing")).json()).toEqual({ date: y });
});
it("missing none when recorded or cancelled (test_missing_none_when_recorded_or_cancelled)", async () => {
  for (let i = 1; i < 15; i++) {
    const x = addDays(todayBerlin(), -i);
    if (isoWeekday(x) !== 1) await (i % 2 ? mk(x, { cancelled: true }) : mk(x, { total: 3 }));
  }
  expect(await (await get("/api/attendance/missing")).json()).toEqual({ date: null });
});
it("auth required (test_auth_required)", async () => {
  expect((await get("/api/attendance", null)).status).toBe(401);
  expect((await get("/api/attendance/missing", null)).status).toBe(401);
});
it("missing response shape (test_missing_has_response_model)", async () => {
  expect(Object.keys((await (await get("/api/attendance/missing")).json()) as object)).toEqual(["date"]);
});
it("missing ignores days with only a Rheinheim class (test_missing_ignores_days_with_only_a_rheinheim_class)", async () => {
  await addSlot({ weekday: 1, start_time: "19:30:00", end_time: "21:30:00", kind: "no_gi", location: "Rheinheim" });
  for (let b = 1; b < 15; b++) {
    const d = addDays(todayBerlin(), -b);
    if (isoWeekday(d) !== 1) await mk(d, { total: 5 });
  }
  expect(await (await get("/api/attendance/missing")).json()).toEqual({ date: null });
});
it("missing finds the most recent open day and ignores inactive slots (new)", async () => {
  await env.DB.prepare("UPDATE slots SET active = 0 WHERE weekday = 3").run();
  const j = (await (await get("/api/attendance/missing")).json()) as any;
  expect(isoWeekday(j.date)).not.toBe(3);
  expect(isoWeekday(j.date)).not.toBe(1);
});
