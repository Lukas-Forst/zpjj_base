import { env } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import { addDays } from "../src/dates";
import { syncCalendar } from "../src/calsync";
import { GoogleCalendar } from "../src/gcal";
import type { CalEvent, CalendarClient } from "../src/gcal";
import { addUser, resetDb } from "./helpers";

const TODAY = "2026-11-09";
const NOW = "2026-11-09T12:00:00.000Z";
const at = (min: number) => new Date(Date.parse(NOW) + min * 60_000).toISOString();
const D1 = addDays(TODAY, 3);
const D2 = addDays(TODAY, 5);
const db = () => env.DB;

class FakeCalendar implements CalendarClient {
  events = new Map<string, CalEvent>();
  failList = false;
  failCreate = false;
  n = 0;
  calls: string[] = [];
  async listEvents() { if (this.failList) throw new Error("google down"); return [...this.events.values()].map((e) => ({ ...e })); }
  async create(title: string, start: string, end: string, baseId: number) {
    if (this.failCreate) throw new Error("create failed");
    const id = `e${++this.n}`;
    this.events.set(id, { id, title, start, end_inclusive: end, private_base_id: String(baseId) });
    this.calls.push("create");
    return id;
  }
  async update(id: string, start: string, end: string) { this.events.set(id, { ...this.events.get(id)!, start, end_inclusive: end }); this.calls.push("update"); }
  async delete(id: string) { this.events.delete(id); this.calls.push("delete"); }
  addManual(title: string, start: string, end: string) { const id = `m${++this.n}`; this.events.set(id, { id, title, start, end_inclusive: end, private_base_id: null }); return id; }
}

let cal: FakeCalendar;
beforeEach(async () => { await resetDb(); cal = new FakeCalendar(); });
const mkUser = (name: string, email?: string) => addUser({ email: email ?? `${name.toLowerCase().replace(/ /g, "")}@example.com`, name, is_trainer: true });
async function mkVac(userId: number, a = D1, b = D2, source = "base", eid: string | null = null) {
  const r = await db().prepare("INSERT INTO vacations (user_id,start_date,end_date,source,gcal_event_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(userId, a, b, source, eid, NOW, NOW).run();
  return r.meta.last_row_id;
}
const vacs = async () => (await db().prepare("SELECT * FROM vacations ORDER BY id").all<any>()).results;
const state = () => db().prepare("SELECT * FROM sync_state WHERE id = 1").first<any>();
const sync = (now = NOW) => syncCalendar(db(), cal, TODAY, now);

it("base vacation is created in calendar", async () => {
  const v = await mkVac(await mkUser("Tim Mustermann"));
  await sync();
  const [e] = [...cal.events.values()];
  expect([e.title, e.start, e.end_inclusive, e.private_base_id]).toEqual(["Tim Urlaub", D1, D2, String(v)]);
  expect((await vacs())[0].gcal_event_id).toBe(e.id);
  const st = await state();
  expect(st.last_ok_at).toBe(NOW);
  expect(st.error).toBeNull();
});
it("event deleted by hand is restored", async () => {
  await mkVac(await mkUser("Tim"));
  await sync();
  cal.events.clear();
  await sync();
  expect(cal.events.size).toBe(1);
  expect(cal.events.has((await vacs())[0].gcal_event_id)).toBe(true);
});
it("event changed by hand is reset", async () => {
  await mkVac(await mkUser("Tim"));
  await sync();
  const id = [...cal.events.keys()][0];
  await cal.update(id, D1, D1);
  await sync();
  expect(cal.events.get(id)!.end_inclusive).toBe(D2);
});
it("manual event becomes calendar vacation", async () => {
  const nico = await mkUser("Nico");
  const eid = cal.addManual("nico urlaub", D1, D2);
  await sync();
  const [v] = await vacs();
  expect([v.user_id, v.source, v.gcal_event_id, v.start_date, v.end_date]).toEqual([nico, "calendar", eid, D1, D2]);
  await sync(); // idempotent
  expect(await vacs()).toHaveLength(1);
});
it("manual event removed removes calendar vacation", async () => {
  await mkUser("Nico");
  const eid = cal.addManual("Nico Urlaub", D1, D2);
  await sync();
  cal.events.delete(eid);
  await sync();
  expect(await vacs()).toEqual([]);
});
it("base vacation deleted removes event", async () => {
  const v = await mkVac(await mkUser("Tim"));
  await sync();
  await db().prepare("DELETE FROM vacations WHERE id = ?").bind(v).run();
  await sync();
  expect(cal.events.size).toBe(0);
});
it("failed fetch changes nothing and sets error", async () => {
  await mkUser("Nico");
  cal.addManual("Nico Urlaub", D1, D2);
  await sync();
  cal.failList = true;
  await sync(at(15));
  expect(await vacs()).toHaveLength(1);
  const st = await state();
  expect(st.error).toBeTruthy();
  expect(st.error_since).toBe(at(15));
  await sync(at(30)); // still failing: error_since stays
  expect((await state()).error_since).toBe(at(15));
  cal.failList = false;
  await sync(at(45));
  const ok = await state();
  expect(ok.error).toBeNull();
  expect(ok.error_since).toBeNull();
});
it("failure while writing leaves nothing partial and flags", async () => {
  const v = await mkVac(await mkUser("Tim"));
  cal.failCreate = true;
  await sync();
  const [row] = await vacs();
  expect([row.id, row.gcal_event_id]).toEqual([v, null]);
  expect((await state()).error).toMatch(/create failed/);
});
it("error text is capped at 500 chars", async () => {
  cal.listEvents = async () => { throw new Error("x".repeat(900)); };
  await sync();
  expect((await state()).error).toHaveLength(500);
});
it("a failing DB batch leaves no partial rows and flags", async () => {
  // a new event with end < start violates the CHECK: the whole batch (incl. the delete of 'old') is rejected
  const nico = await mkUser("Nico");
  const stale = await mkVac(nico, D1, D2, "calendar", "old");
  cal.events.set("bad", { id: "bad", title: "Nico Urlaub", start: D2, end_inclusive: D1, private_base_id: null });
  await sync();
  expect((await vacs()).map((r) => r.id)).toEqual([stale]);
  expect((await state()).error).toBeTruthy();
});
it("unmatched and ambiguous are reported", async () => {
  await mkUser("Tim A", "a@example.com");
  await mkUser("Tim B", "b@example.com");
  cal.addManual("Tim Urlaub", D1, D2);
  cal.addManual("Hochzeit", D1, D2);
  cal.addManual("Unbekannt Urlaub", D1, D2);
  await sync();
  expect(await vacs()).toEqual([]);
  expect(JSON.parse((await state()).unmatched)).toEqual(["Hochzeit", "Tim Urlaub", "Unbekannt Urlaub"]);
});
it("imported vacation survives when title becomes ambiguous", async () => {
  await mkUser("Tim", "a@example.com");
  cal.addManual("Tim Urlaub", D1, D2);
  await sync();
  expect(await vacs()).toHaveLength(1);
  await mkUser("Tim B", "b@example.com");
  await sync();
  expect(await vacs()).toHaveLength(1);
  expect(JSON.parse((await state()).unmatched)).toEqual(["Tim Urlaub"]);
});
it("reused row id does not adopt foreign event", async () => {
  const nico = await mkUser("Nico");
  const can = await mkUser("Can");
  const v = await mkVac(nico);
  await sync();
  await db().prepare("DELETE FROM vacations WHERE id = ?").bind(v).run();
  await db().prepare("INSERT INTO vacations (id,user_id,start_date,end_date,source,created_at,updated_at) VALUES (?,?,?,?,'base',?,?)").bind(v, can, D1, D2, NOW, NOW).run();
  await sync();
  expect([...cal.events.values()].map((e) => e.title)).toEqual(["Can Urlaub"]);
});
it("hand-edited title is restored", async () => {
  await mkVac(await mkUser("Tim"));
  await sync();
  const id = [...cal.events.keys()][0];
  cal.events.get(id)!.title = "Tim im Urlaub";
  await sync();
  expect([...cal.events.values()].map((e) => e.title)).toEqual(["Tim Urlaub"]);
});
it("unchanged state writes no extra calendar calls", async () => {
  await mkVac(await mkUser("Tim"));
  await sync();
  cal.calls.length = 0;
  await sync();
  expect(cal.calls).toEqual([]);
});
it("overlapping run that already imported the event does not fail (unique gcal_event_id)", async () => {
  const nico = await mkUser("Nico");
  await mkVac(nico, "2020-01-01", "2020-01-02", "calendar", "m1"); // outside the read window, same event id
  cal.events.set("m1", { id: "m1", title: "Nico Urlaub", start: D1, end_inclusive: D2, private_base_id: null });
  await sync();
  expect((await state()).error).toBeNull();
  expect((await vacs()).filter((r) => r.gcal_event_id === "m1")).toHaveLength(1);
});
it("malformed service account secret is flagged without leaking it", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const bad = new GoogleCalendar("c", '{"private_key": SECRETMARKER "x"');
  await syncCalendar(db(), bad, TODAY, NOW);
  const st = await state();
  expect(st.error).toContain("GCAL_SERVICE_ACCOUNT_JSON ungültig");
  expect(JSON.stringify(spy.mock.calls)).not.toContain("SECRETMARKER");
  expect(st.error).not.toContain("SECRETMARKER");
  spy.mockRestore();
});
