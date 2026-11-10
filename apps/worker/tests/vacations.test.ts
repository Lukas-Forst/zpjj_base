import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { addDays, todayBerlin } from "../src/dates";
import { hooks } from "../src/hooks";
import { addUser, call, resetDb } from "./helpers";

const T = todayBerlin();
const d = (n: number) => addDays(T, n);
const BOSS = "boss@example.com";
const TIM = "tim@example.com";
const CAN = "can@example.com";
let tim: number;
beforeEach(async () => {
  await resetDb();
  hooks.onVacationChange = undefined;
  await addUser({ email: BOSS, role: "gesellschafter", is_trainer: false });
  tim = await addUser({ email: TIM, name: "Tim", is_trainer: true });
  await addUser({ email: CAN, name: "Can", is_trainer: true });
});
const post = (as: string, a: string, b: string, extra: object = {}) =>
  call("/api/vacations", { as, json: { start_date: a, end_date: b, ...extra } });
const list = async (as = TIM) => (await (await call("/api/vacations", { as })).json()) as any[];

it("trainer creates own (test_trainer_creates_own)", async () => {
  const r = await post(TIM, d(3), d(5));
  expect(r.status).toBe(201);
  const j = (await r.json()) as any;
  expect(j.user_name).toBe("Tim");
  expect(j.source).toBe("base");
  expect(await list()).toHaveLength(1);
});
it("trainer cannot create for other (test_trainer_cannot_create_for_other)", async () => {
  const other = await addUser({ email: "x@example.com" });
  expect((await post(TIM, d(3), d(4), { user_id: other })).status).toBe(403);
});
it("gesellschafter creates for other (test_gesellschafter_creates_for_other)", async () => {
  const other = await addUser({ email: "x@example.com", is_trainer: true });
  expect((await post(BOSS, d(3), d(4), { user_id: other })).status).toBe(201);
});
it("non trainer target rejected (test_non_trainer_target_rejected)", async () => {
  const nt = await addUser({ email: "nt@example.com", is_trainer: false });
  expect((await post(BOSS, d(3), d(4), { user_id: nt })).status).toBe(422);
});
it("end before start 422 with detail string (test_end_before_start_422)", async () => {
  const r = await post(TIM, d(5), d(3));
  expect(r.status).toBe(422);
  expect(((await r.json()) as any).detail).toBe("Ende liegt vor dem Beginn");
});
it("invalid date 422", async () => {
  expect((await post(TIM, "2026-02-30", "2026-03-01")).status).toBe(422);
});
it("overlap and adjacent merge (test_overlap_and_adjacent_merge)", async () => {
  await post(TIM, d(3), d(5));
  const r = await post(TIM, d(6), d(8)); // adjacent
  await post(TIM, d(4), d(10)); // overlapping
  const rows = await list();
  expect(rows).toHaveLength(1);
  expect([rows[0].start_date, rows[0].end_date]).toEqual([d(3), d(10)]);
  expect(r.status).toBe(201);
});
it("merge collapses several entries into one and keeps calendar entries apart", async () => {
  await post(TIM, d(3), d(4));
  await post(TIM, d(8), d(9));
  await env.DB.prepare(
    "INSERT INTO vacations (user_id, start_date, end_date, source, gcal_event_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  ).bind(tim, d(5), d(7), "calendar", "g1", "x", "x").run();
  await post(TIM, d(5), d(7)); // touches both base entries
  const rows = await list();
  expect(rows.map((r) => [r.start_date, r.end_date, r.source])).toEqual([
    [d(3), d(9), "base"],
    [d(5), d(7), "calendar"],
  ]);
});
it("delete rules (test_delete_rules)", async () => {
  const vid = ((await (await post(TIM, d(3), d(4))).json()) as any).id;
  expect((await call(`/api/vacations/${vid}`, { as: CAN, method: "DELETE" })).status).toBe(403);
  expect((await call(`/api/vacations/${vid}`, { as: TIM, method: "DELETE" })).status).toBe(204);
  expect((await call(`/api/vacations/${vid}`, { as: TIM, method: "DELETE" })).status).toBe(404);
});
it("past vacation only gesellschafter (test_past_vacation_only_gesellschafter)", async () => {
  expect((await post(TIM, d(-10), d(-8))).status).toBe(403);
  const uid = await addUser({ email: "p@example.com", is_trainer: true });
  const vid = ((await (await post(BOSS, d(-10), d(-8), { user_id: uid })).json()) as any).id;
  expect((await call(`/api/vacations/${vid}`, { as: BOSS, method: "DELETE" })).status).toBe(204);
});
it("past delete forbidden for trainer (test_past_delete_forbidden_for_trainer)", async () => {
  const vid = ((await (await post(BOSS, d(-10), d(-8), { user_id: tim })).json()) as any).id;
  expect((await call(`/api/vacations/${vid}`, { as: TIM, method: "DELETE" })).status).toBe(403);
});
it("list starts 7 days back", async () => {
  await post(BOSS, d(-10), d(-8), { user_id: tim });
  await post(BOSS, d(-10), d(-7), { user_id: tim });
  expect((await list()).map((r) => r.end_date)).toEqual([d(-7)]);
});
it("requires login (test_requires_login)", async () => {
  expect((await call("/api/vacations")).status).toBe(401);
});
it("calendar entry cannot be deleted in base (test_calendar_entry_cannot_be_deleted_in_base)", async () => {
  const uid = await addUser({ email: "c@example.com", is_trainer: true });
  const r = await env.DB.prepare(
    "INSERT INTO vacations (user_id, start_date, end_date, source, gcal_event_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  ).bind(uid, d(3), d(4), "calendar", "g1", "x", "x").run();
  const res = await call(`/api/vacations/${r.meta.last_row_id}`, { as: BOSS, method: "DELETE" });
  expect(res.status).toBe(409);
  expect(((await res.json()) as any).detail).toContain("Kalender");
});
it("hook runs after POST and DELETE; its failure never fails the request (test_sync_hook_failure_never_fails_the_request)", async () => {
  let calls = 0;
  hooks.onVacationChange = async () => {
    calls++;
    throw new Error("db locked");
  };
  const r = await post(TIM, d(3), d(4));
  expect(r.status).toBe(201);
  const vid = ((await r.json()) as any).id;
  expect((await call(`/api/vacations/${vid}`, { as: TIM, method: "DELETE" })).status).toBe(204);
  expect(calls).toBe(2);
});
it("hook not called for rejected requests", async () => {
  let calls = 0;
  hooks.onVacationChange = async () => void calls++;
  await post(TIM, d(5), d(3));
  await post(TIM, d(-10), d(-8));
  expect(calls).toBe(0);
});
it("end before start is rejected by the schema (test_vacation_end_before_start_rejected)", async () => {
  await expect(
    env.DB.prepare("INSERT INTO vacations (user_id, start_date, end_date, source, created_at, updated_at) VALUES (?,?,?,?,?,?)")
      .bind(tim, d(5), d(4), "base", "x", "x").run(),
  ).rejects.toThrow();
});
it("migration creates the tables (test_migration_creates_new_tables)", async () => {
  const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all<{ name: string }>();
  const names = r.results.map((x) => x.name);
  for (const t of ["vacations", "substitutes", "sync_state"]) expect(names).toContain(t);
});
