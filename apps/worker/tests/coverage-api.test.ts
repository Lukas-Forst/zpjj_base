import { beforeEach, expect, it } from "vitest";
import { addDays, isoWeekday, todayBerlin } from "../src/dates";
import { addSlot, addUser, call, resetDb } from "./helpers";

const DAY = addDays(todayBerlin(), 3);
let a: number, b: number, c: number, sid: number;
const BOSS = "boss@example.com", NICO = "nico@example.com", TIM = "tim@example.com";
beforeEach(async () => {
  await resetDb();
  await addUser({ email: BOSS, role: "gesellschafter", is_trainer: false });
  a = await addUser({ email: NICO, name: "nico", is_trainer: true });
  b = await addUser({ email: "can@example.com", name: "can", is_trainer: true });
  c = await addUser({ email: TIM, name: "tim", is_trainer: true });
  sid = await addSlot({ weekday: isoWeekday(DAY), start_time: "18:00:00", end_time: "20:00:00", kind: "no_gi", trainers: [a, b] });
});
const vac = async (uid: number) => {
  const r = await call("/api/vacations", { as: BOSS, json: { user_id: uid, start_date: DAY, end_date: DAY } });
  expect(r.status).toBe(201);
};
const put = (as: string, o: object = {}, date = DAY) =>
  call("/api/coverage/substitutes", { as, method: "PUT", json: { slot_id: sid, date, ...o } });
const gaps = async () => (await (await call("/api/coverage", { as: TIM })).json()) as any[];

it("gap after both on vacation (test_gap_after_both_on_vacation)", async () => {
  expect(await gaps()).toEqual([]);
  await vac(a);
  await vac(b);
  const g = await gaps();
  expect(g).toHaveLength(1);
  expect([g[0].level, g[0].date, g[0].kind, g[0].location]).toEqual(["unbesetzt", DAY, "no_gi", null]);
  expect(g[0].absent.sort()).toEqual(["can", "nico"]);
  expect([g[0].slot_id, g[0].weekday, g[0].start_time]).toEqual([sid, isoWeekday(DAY), "18:00:00"]);
});
it("substitute clears gap and can be withdrawn (test_substitute_clears_gap_and_can_be_withdrawn)", async () => {
  await vac(a);
  await vac(b);
  expect((await put(TIM)).status).toBe(204);
  expect((await put(TIM)).status).toBe(204); // idempotent (merge)
  expect(await gaps()).toEqual([]);
  const r = await call(`/api/coverage/substitutes?slot_id=${sid}&date=${DAY}&user_id=${c}`, { as: TIM, method: "DELETE" });
  expect(r.status).toBe(204);
  expect(await gaps()).toHaveLength(1);
});
it("substitute on vacation conflict (test_substitute_on_vacation_conflict)", async () => {
  await vac(a);
  await vac(c);
  const r = await put(TIM);
  expect(r.status).toBe(409);
  expect(((await r.json()) as any).detail).toContain("Urlaub");
});
it("wrong weekday 422 (test_wrong_weekday_422)", async () => {
  await vac(a);
  expect((await put(TIM, {}, addDays(DAY, 1))).status).toBe(422);
});
it("non trainer cannot substitute 422", async () => {
  await vac(a);
  expect((await put(BOSS, { user_id: (await addUser({ email: "n@example.com", is_trainer: false })) })).status).toBe(422);
});
it("trainer cannot substitute for other (test_trainer_cannot_substitute_for_other)", async () => {
  await vac(a);
  expect((await put(TIM, { user_id: b })).status).toBe(403);
  expect((await put(BOSS, { user_id: c })).status).toBe(204);
});
it("withdraw rules: other's substitute only for gesellschafter", async () => {
  await vac(a);
  await put(TIM);
  const url = `/api/coverage/substitutes?slot_id=${sid}&date=${DAY}&user_id=${c}`;
  expect((await call(url, { as: NICO, method: "DELETE" })).status).toBe(403);
  expect((await call(url, { as: BOSS, method: "DELETE" })).status).toBe(204);
});
it("list substitutes (test_list_substitutes)", async () => {
  await vac(a);
  await put(TIM);
  const r = (await (await call("/api/coverage/substitutes", { as: TIM })).json()) as any[];
  expect(r.map((x) => [x.slot_id, x.date, x.user_id, x.user_name, x.kind])).toEqual([[sid, DAY, c, "tim", "no_gi"]]);
});
it("coverage requires login", async () => {
  expect((await call("/api/coverage")).status).toBe(401);
});
