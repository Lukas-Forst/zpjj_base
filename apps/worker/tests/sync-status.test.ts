import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { calendar } from "../src/calsync";
import { addDays, todayBerlin } from "../src/dates";
import worker from "../src/index";
import { addUser, call, resetDb } from "./helpers";

// FakeCalendar kept tiny here: the full semantics are covered in calsync.test.ts
function fake() {
  const events = new Map<string, any>();
  return {
    events, fail: false, listCalls: 0,
    async listEvents() { this.listCalls++; if (this.fail) throw new Error("google down"); return [...events.values()]; },
    async create(title: string, start: string, end: string, baseId: number) { const id = `e${events.size + 1}`; events.set(id, { id, title, start, end_inclusive: end, private_base_id: String(baseId) }); return id; },
    async update() {}, async delete() {},
  };
}
const D = addDays(todayBerlin(), 3);
const H = "t@example.com";
const orig = calendar.makeClient;
beforeEach(async () => { await resetDb(); await addUser({ email: H, name: "Tim", is_trainer: true }); });
afterEach(() => { calendar.makeClient = orig; vi.restoreAllMocks(); });
const addVac = () => call("/api/vacations", { as: H, json: { start_date: D, end_date: D } });
const status = async () => (await (await call("/api/sync-status", { as: H })).json()) as any;
/** waitUntil work of the request: poll until the sync has settled. */
const settle = () => vi.waitFor(async () => expect((await env.DB.prepare("SELECT 1 FROM sync_state WHERE id = 1").first()) !== null).toBe(true));

it("disabled without configuration (test_disabled_without_configuration)", async () => {
  const r = await status();
  expect(r.enabled).toBe(false);
  expect(r.ok).toBe(true);
  expect((await addVac()).status).toBe(201);
  await new Promise((r) => setTimeout(r, 50));
  expect(await env.DB.prepare("SELECT 1 FROM sync_state").first()).toBeNull(); // no-op
});
it("vacation write syncs to calendar exactly once (test_vacation_write_syncs_to_calendar)", async () => {
  const f = fake();
  calendar.makeClient = () => f as any;
  expect((await addVac()).status).toBe(201);
  await settle();
  expect([...f.events.values()].map((e) => e.title)).toEqual(["Tim Urlaub"]);
  expect(f.listCalls).toBe(1);
  const s = await status();
  expect(s.enabled && s.ok && s.last_ok_at).toBeTruthy();
  expect(s.error_since).toBeNull();
  expect(s.unmatched).toEqual([]);
});
it("vacation delete triggers a sync too", async () => {
  const f = fake();
  calendar.makeClient = () => f as any;
  const id = ((await (await addVac()).json()) as any).id;
  await settle();
  expect((await call(`/api/vacations/${id}`, { as: H, method: "DELETE" })).status).toBe(204);
  await vi.waitFor(() => expect(f.listCalls).toBe(2));
});
it("calendar failure flags but request succeeds (test_calendar_failure_flags_but_request_succeeds)", async () => {
  const f = fake();
  f.fail = true;
  calendar.makeClient = () => f as any;
  expect((await addVac()).status).toBe(201);
  await settle();
  const s = await status();
  expect(s.enabled).toBe(true);
  expect(s.ok).toBe(false);
  expect(s.error_since).toBeTruthy();
});
it("cron runs the sync and never throws", async () => {
  const f = fake();
  calendar.makeClient = () => f as any;
  await worker.scheduled({} as any, env as any, {} as any);
  expect(f.listCalls).toBe(1);
  expect((await status()).last_ok_at).toBeTruthy();
  calendar.makeClient = () => { throw new Error("boom"); };
  await expect(worker.scheduled({} as any, env as any, {} as any)).resolves.toBeUndefined();
});
it("cron is a no-op without configuration", async () => {
  await worker.scheduled({} as any, env as any, {} as any);
  expect(await env.DB.prepare("SELECT 1 FROM sync_state").first()).toBeNull();
  expect(exports).toBeTruthy();
});
