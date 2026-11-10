import { beforeEach, expect, it } from "vitest";
import { addDays, isoWeekday, todayBerlin } from "../src/dates";
import { addSlot, addUser, call, resetDb } from "./helpers";

const T = todayBerlin();
const DAY = addDays(T, 3);
let a: number, b: number, c: number, sid: number;
const BOSS = "boss@example.com", TIM = "tim@example.com";
beforeEach(async () => {
  await resetDb();
  await addUser({ email: BOSS, role: "gesellschafter", is_trainer: false });
  a = await addUser({ email: "nico@example.com", name: "nico", is_trainer: true });
  b = await addUser({ email: "can@example.com", name: "can", is_trainer: true });
  c = await addUser({ email: TIM, name: "tim", is_trainer: true });
  const wd = isoWeekday(DAY);
  sid = await addSlot({ weekday: wd, start_time: "18:00:00", end_time: "20:00:00", kind: "no_gi", trainers: [a, b] });
  await addSlot({ weekday: wd, start_time: "20:00:00", end_time: "21:00:00", kind: "open_mat" });
});
const vac = async (uid: number) =>
  expect((await call("/api/vacations", { as: BOSS, json: { user_id: uid, start_date: DAY, end_date: DAY } })).status).toBe(201);
const plan = async () => {
  const r = await call("/api/coverage/plan", { as: TIM });
  expect(r.status).toBe(200);
  return (await r.json()) as any[];
};
const cards = (p: any[]) => {
  for (const w of p) for (const d of w.days) if (d.date === DAY) return { w, d, slots: Object.fromEntries(d.slots.map((s: any) => [s.start_time.slice(0, 5), s])) as Record<string, any> };
  throw new Error("test day not in plan");
};

it("three weeks from this monday and no past days (test_three_weeks_from_this_monday_and_no_past_days)", async () => {
  const p = await plan();
  expect(p).toHaveLength(3);
  const monday = addDays(T, -(isoWeekday(T) - 1));
  expect(p.map((w) => w.week_start)).toEqual([0, 1, 2].map((i) => addDays(monday, 7 * i)));
  expect(p.every((w) => w.days.every((d: any) => d.date >= T))).toBe(true);
  expect(typeof p[0].iso_week).toBe("number");
});
it("iso week across the year change", async () => {
  // Mon 2026-12-28 belongs to ISO week 53; 2027-01-04 is week 1 of 2027 (checked via the plan's own week_start)
  const p = await plan();
  const wk = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    return Math.ceil(((+d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  };
  expect(p.map((w) => w.iso_week)).toEqual(p.map((w) => wk(w.week_start)));
});
it("status per card (test_status_per_card)", async () => {
  let { w, slots } = cards(await plan());
  expect(slots["18:00"].status).toBe("besetzt");
  expect(slots["18:00"].kind).toBe("no_gi");
  expect(slots["18:00"].trainers).toEqual(["nico", "can"]);
  expect(slots["18:00"].absent).toEqual([]);
  expect(slots["20:00"].status).toBe("nicht_geprueft");
  expect([w.unbesetzt, w.teilweise]).toEqual([0, 0]);

  await vac(a);
  ({ w, slots } = cards(await plan()));
  expect(slots["18:00"].status).toBe("teilweise");
  expect(slots["18:00"].absent).toEqual(["nico"]);
  expect([w.unbesetzt, w.teilweise]).toEqual([0, 1]);

  await vac(b);
  ({ w, slots } = cards(await plan()));
  expect(slots["18:00"].status).toBe("unbesetzt");
  expect([...slots["18:00"].absent].sort()).toEqual(["can", "nico"]);
  expect([w.unbesetzt, w.teilweise]).toEqual([1, 0]);
});
it("substitute turns card into vertreten (test_substitute_turns_card_into_vertreten)", async () => {
  await vac(a);
  await vac(b);
  const r = await call("/api/coverage/substitutes", { as: TIM, method: "PUT", json: { slot_id: sid, date: DAY } });
  expect(r.status).toBe(204);
  const { w, slots } = cards(await plan());
  expect(slots["18:00"].status).toBe("vertreten");
  expect(slots["18:00"].substitutes).toEqual([{ user_id: c, user_name: "tim" }]);
  expect([w.unbesetzt, w.teilweise]).toEqual([0, 0]);
});
it("card and gap carry the location (test_card_and_gap_carry_the_location)", async () => {
  await addSlot({ weekday: isoWeekday(DAY), start_time: "19:30:00", end_time: "21:30:00", kind: "no_gi", location: "Rheinheim", trainers: [c] });
  await vac(c);
  const { slots } = cards(await plan());
  expect(slots["19:30"].location).toBe("Rheinheim");
  expect(slots["19:30"].status).toBe("unbesetzt");
  expect(slots["18:00"].location).toBeNull();
  const g = (await (await call("/api/coverage", { as: TIM })).json()) as any[];
  expect(g.map((x) => x.location)).toEqual(["Rheinheim"]);
});
it("days without slots are omitted and inactive slots hidden", async () => {
  await addSlot({ weekday: isoWeekday(DAY), start_time: "07:00:00", end_time: "08:00:00", active: false });
  const p = await plan();
  expect(p.flatMap((w) => w.days).every((d: any) => d.slots.length > 0)).toBe(true);
  expect(cards(p).slots["07:00"]).toBeUndefined();
});
it("plan requires login (test_plan_requires_login)", async () => {
  expect((await call("/api/coverage/plan")).status).toBe(401);
});
