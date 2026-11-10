import { env, exports } from "cloudflare:workers";
import { beforeEach, expect, it, vi } from "vitest";
import { addDays, isoWeekday, todayBerlin } from "../src/dates";
import { addSlot, addUser, call, resetDb } from "./helpers";

const EMAIL = "t@example.com";
function last(isoday: number, back = 0): string {
  let d = addDays(todayBerlin(), -1);
  while (isoWeekday(d) !== isoday) d = addDays(d, -1);
  return addDays(d, -7 * back);
}
beforeEach(async () => {
  await resetDb();
  await addUser({ email: EMAIL });
  for (const wd of [3, 5, 7]) await addSlot({ weekday: wd, start_time: "18:00:00", end_time: "20:00:00", kind: "gi" });
});
const put = (d: string, json: object, as: string | null = EMAIL) => call(`/api/attendance/${d}`, { method: "PUT", as: as ?? undefined, json });
const trials = async () => (await env.DB.prepare("SELECT name, first_date, status FROM trials ORDER BY name").all<any>()).results;
const count = async (t: string) => (await env.DB.prepare(`SELECT COUNT(*) n FROM ${t}`).first<{ n: number }>())!.n;
const imported = (name: string, first: string) =>
  env.DB.prepare("INSERT INTO trials (name, name_key, first_date) VALUES (?,?,?)").bind(name, name.toLowerCase(), first).run();
// raw SQL only where member_since must stay NULL (PATCH would set it to today)
const flagNull = (name: string) => env.DB.prepare("UPDATE trials SET status='mitglied', member_since=NULL WHERE name=?").bind(name).run();
const flag = async (name: string, since?: string) => {
  const t = (await env.DB.prepare("SELECT id FROM trials WHERE name=?").bind(name).first<{ id: number }>())!;
  const r = await call(`/api/trials/${t.id}`, { method: "PATCH", as: EMAIL, json: since ? { status: "mitglied", member_since: since } : { status: "mitglied" } });
  expect(r.status).toBe(200);
};
const statuses = async () => Object.fromEntries((await trials()).map((t) => [t.name, t.status]));

it("weekday saves counts and trial (test_put_weekday_saves_counts_and_trial)", async () => {
  const d = last(3);
  const r = await put(d, { total: 10, trial_names: ["David"] });
  expect(r.status).toBe(200);
  const j = (await r.json()) as any;
  expect(j).toMatchObject({ members: 9, names: ["David"], total: 10, updated_by_name: "t" });
  expect(await trials()).toEqual([{ name: "David", first_date: d, status: "offen" }]);
});
it("sunday (test_put_sunday)", async () => {
  const d = last(7);
  const j = (await (await put(d, { total: 4, open_mat: 4, beginner: 15 })).json()) as any;
  expect([j.total, j.open_mat, j.beginner]).toEqual([4, 4, 15]);
  expect(((await (await put(d, { total: 5 })).json()) as any).beginner).toBeNull();
});
it("replace removes orphan trial (test_replace_removes_orphan_trial)", async () => {
  const d = last(3);
  await put(d, { total: 10, trial_names: ["Davd"] });
  await put(d, { total: 10, trial_names: ["David"] });
  expect((await trials()).map((t) => t.name)).toEqual(["David"]);
});
it("same name other day is same person (test_same_name_other_day_is_same_person)", async () => {
  const d1 = last(3, 1), d2 = last(3);
  await put(d2, { total: 10, trial_names: ["David"] });
  await put(d1, { total: 8, trial_names: ["david"] });
  const t = await trials();
  expect(t).toHaveLength(1);
  expect(t[0].first_date).toBe(d1);
  expect(await count("trial_attendance")).toBe(2);
  await put(d1, { total: 8 });
  expect((await trials())[0].first_date).toBe(d2);
});
it("cancelled day (test_cancelled_day)", async () => {
  const d = last(3);
  await put(d, { total: 10, trial_names: ["David"] });
  const j = (await (await put(d, { cancelled: true })).json()) as any;
  expect([j.cancelled, j.total, j.members]).toEqual([true, null, null]);
  expect(await count("trial_attendance")).toBe(0);
  expect(await count("trials")).toBe(0);
});
it("rejects future and closed day (test_rejects_future_and_closed_day)", async () => {
  let r = await put(addDays(todayBerlin(), 1), { total: 1 });
  expect(r.status).toBe(422);
  expect(((await r.json()) as any).detail).toBe("Für die Zukunft kann nichts eingetragen werden.");
  r = await put(last(1), { total: 1 });
  expect(r.status).toBe(422);
  expect(((await r.json()) as any).detail).toBe("An diesem Tag ist kein Training.");
});
it("rheinheim slot does not open a day (test_rheinheim_slot_does_not_open_a_day)", async () => {
  await addSlot({ weekday: 1, start_time: "19:30:00", end_time: "21:30:00", kind: "no_gi", location: "Rheinheim" });
  const r = await put(last(1), { total: 1 });
  expect(r.status).toBe(422);
  expect(((await r.json()) as any).detail).toBe("An diesem Tag ist kein Training.");
});
it("rejects absurd count (test_rejects_absurd_count)", async () => {
  expect((await put(last(3), { total: 5000 })).status).toBe(422);
  expect((await put(last(7), { total: 5, open_mat: 5000 })).status).toBe(422);
  expect((await put(last(3), {})).status).toBe(422);
});
it("empty or duplicate name rejected (test_empty_or_duplicate_name_rejected)", async () => {
  for (const names of [["  "], ["David", "david"]]) {
    const r = await put(last(3), { total: 10, trial_names: names });
    expect(r.status).toBe(422);
    expect(typeof ((await r.json()) as any).detail).toBe("string");
  }
});
it("names exceeding total rejected (test_names_exceeding_total_rejected)", async () => {
  expect((await put(last(3), { total: 1, trial_names: ["A1", "B2"] })).status).toBe(422);
  expect((await put(last(3), { total: 2, trial_names: ["A1"], guests: 2 })).status).toBe(422);
});
it("guests reduce members (test_guests_reduce_members)", async () => {
  const j = (await (await put(last(3), { total: 10, trial_names: ["David"], guests: 2 })).json()) as any;
  expect([j.members, j.guests, j.trials]).toEqual([7, 2, 1]);
});
it("member flagged name rejected (test_member_flagged_name_rejected)", async () => {
  await imported("Anna", last(3, 3));
  await flagNull("Anna");
  const r = await put(last(3), { total: 10, trial_names: ["anna"] });
  expect(r.status).toBe(422);
  expect(((await r.json()) as any).detail.toLowerCase()).toContain("anna");
});
it("open mat only sunday (test_open_mat_only_sunday)", async () => {
  const r = await put(last(3), { total: 5, open_mat: 2 });
  expect(r.status).toBe(422);
  expect(((await r.json()) as any).detail).toContain("sonntags");
});
it("parse endpoint gone (test_parse_endpoint_gone)", async () => {
  const r = await call("/api/attendance/parse", { method: "POST", as: EMAIL, json: {} });
  expect([404, 405]).toContain(r.status);
});
it("unauthenticated is 401 (test_unauthenticated_is_401)", async () => {
  expect((await put(last(3), { total: 1 }, null)).status).toBe(401);
});
it("cancel sunday (test_cancel_sunday)", async () => {
  expect(((await (await put(last(7), { cancelled: true })).json()) as any).cancelled).toBe(true);
});
it("imported trial keeps earlier first_date (test_imported_trial_keeps_earlier_first_date)", async () => {
  const d = last(3);
  await imported("Anna", addDays(d, -60));
  await put(d, { total: 10, trial_names: ["Anna"] });
  expect((await trials())[0].first_date).toBe(addDays(d, -60));
});
it("correcting imported name does not delete person (test_correcting_imported_name_does_not_delete_person)", async () => {
  const d = last(3);
  await imported("Anna", addDays(d, -60));
  await put(d, { total: 10, trial_names: ["Anna"] });
  await put(d, { total: 10, trial_names: ["Anne"] });
  expect(Object.fromEntries((await trials()).map((t) => [t.name, t.first_date]))).toEqual({ Anna: addDays(d, -60), Anne: d });
});
it("input caps (test_input_caps)", async () => {
  const d = last(3);
  const ok = async (n: string[]) => (await put(d, { total: 40, trial_names: n })).status;
  expect(await ok(Array.from({ length: 31 }, (_, i) => `Ab${i}`))).toBe(422);
  expect(await ok(["a".repeat(101)])).toBe(422);
  expect(await ok(["a".repeat(100)])).toBe(200);
});
it("resave keeps flagged person linked to day (test_resave_keeps_flagged_person_linked_to_day)", async () => {
  const d = last(3);
  expect((await put(d, { total: 5, trial_names: ["Zed"] })).status).toBe(200);
  await flag("Zed");
  expect((await put(d, { total: 5, trial_names: ["Zed"] })).status).toBe(200);
  expect(await statuses()).toEqual({ Zed: "mitglied" });
});
it("dropping or cancelling keeps flagged person (test_dropping_or_cancelling_keeps_flagged_person)", async () => {
  const d = last(3);
  await put(d, { total: 5, trial_names: ["Zed"] });
  await flag("Zed");
  expect((await put(d, { total: 5 })).status).toBe(200);
  expect(await statuses()).toEqual({ Zed: "mitglied" });
  await put(d, { total: 5, trial_names: ["Zed"] });
  expect((await put(d, { cancelled: true })).status).toBe(200);
  expect(await statuses()).toEqual({ Zed: "mitglied" });
});
it("flagged before member_since allowed, after rejected (test_flagged_person_before_member_since_allowed_after_rejected)", async () => {
  await imported("Anna", last(3, 3));
  const d = last(3);
  await flag("Anna", addDays(d, 1));
  expect((await put(d, { total: 5, trial_names: ["Anna"] })).status).toBe(200);
  await flag("Anna", d);
  await put(d, { total: 5 });
  const r = await put(d, { total: 5, trial_names: ["Anna"] });
  expect(r.status).toBe(422);
  expect(((await r.json()) as any).detail).toContain("Anna");
});
it("rejected request leaves row counts unchanged (new)", async () => {
  const d = last(3);
  await put(d, { total: 10, trial_names: ["David"] });
  await imported("Anna", last(3, 3));
  await flagNull("Anna");
  const before = [await count("attendance"), await count("trials"), await count("trial_attendance")];
  for (const body of [
    { total: 10, trial_names: ["New", "new"] },
    { total: 1, trial_names: ["New", "Other"] },
    { total: 10, trial_names: ["New", "Anna"] },
    { total: 10, trial_names: ["New"], open_mat: 3 },
  ])
    expect((await put(d, body)).status).toBe(422);
  expect((await put(last(5), { total: 1000000, trial_names: ["New"] })).status).toBe(422);
  expect([await count("attendance"), await count("trials"), await count("trial_attendance")]).toEqual(before);
});
it("casefold key handles sharp s (new)", async () => {
  const d = last(3);
  await put(d, { total: 5, trial_names: ["Strasse"] });
  expect((await put(d, { total: 5, trial_names: ["STRAßE"] })).status).toBe(200);
  expect(await trials()).toHaveLength(1);
});

// test_attendance_models.py: CHECK / UNIQUE / FK constraints
const D = "2026-11-10";
const ins = (total: number | null, trials: number, guests = 0, date = D) =>
  env.DB.prepare("INSERT INTO attendance (date, total, trials, guests, updated_at) VALUES (?,?,?,?,'x')").bind(date, total, trials, guests).run();
it("trials cannot exceed total (test_trials_cannot_exceed_total)", async () => {
  await expect(ins(3, 4)).rejects.toThrow();
});
it("name_key unique (test_name_key_unique)", async () => {
  await imported("Max", D);
  await expect(imported("MAX", D)).rejects.toThrow();
});
it("deleting day requires links gone (test_deleting_day_requires_links_gone)", async () => {
  await ins(3, 1);
  await imported("Max", D);
  await env.DB.prepare("INSERT INTO trial_attendance (trial_id, date) SELECT id, ? FROM trials").bind(D).run();
  await expect(env.DB.prepare("DELETE FROM attendance").run()).rejects.toThrow();
});
it("guests default zero and bounded (test_guests_default_zero_and_bounded)", async () => {
  await env.DB.prepare("INSERT INTO attendance (date, total, trials, updated_at) VALUES (?,3,1,'x')").bind(D).run();
  expect((await env.DB.prepare("SELECT guests FROM attendance").first<any>()).guests).toBe(0);
  await expect(ins(3, 1, 3, "2026-11-11")).rejects.toThrow();
});
it("trial status default offen (test_trial_status_default_offen)", async () => {
  await imported("Max", D);
  expect(await trials()).toEqual([{ name: "Max", first_date: D, status: "offen" }]);
  expect((await env.DB.prepare("SELECT member_since FROM trials").first<any>()).member_since).toBeNull();
});
it("invalid status rejected (test_invalid_status_rejected)", async () => {
  await expect(env.DB.prepare("INSERT INTO trials (name, name_key, first_date, status) VALUES ('a','a',?, 'x')").bind(D).run()).rejects.toThrow();
});

it("30-name PUT stays within the D1 statement budget", async () => {
  const d = last(3);
  const names = Array.from({ length: 30 }, (_, i) => `Person${String.fromCharCode(97 + (i % 26))}${i}`);
  await put(d, { total: 40, trial_names: names.slice(0, 15) }); // some exist already, so old links are cleaned too
  const spy = vi.spyOn(env.DB, "prepare");
  const batchSpy = vi.spyOn(env.DB, "batch");
  const r = await put(d, { total: 40, trial_names: names });
  const batched = batchSpy.mock.calls.reduce((n, c) => n + (c[0] as unknown[]).length, 0);
  const outside = spy.mock.calls.length - batched;
  const batches = batchSpy.mock.calls.length;
  spy.mockRestore();
  batchSpy.mockRestore();
  expect(r.status).toBe(200);
  expect(outside).toBeLessThanOrEqual(12);
  expect(batches).toBe(1);
});

it("malformed or non-JSON body gives 422 with a German detail", async () => {
  const d = last(3);
  const raw = (body: string, type: string) =>
    exports.default.fetch(new Request(`http://example.com/api/attendance/${d}`, { method: "PUT", headers: { "X-Test-User": EMAIL, "Content-Type": type }, body }));
  for (const r of [await raw("{nope", "application/json"), await raw("total=5", "text/plain")]) {
    expect(r.status).toBe(422);
    expect(await r.json()).toEqual({ detail: "Ungültige Eingabe." });
  }
});
it("missing required field gives the German default, own German messages stay verbatim", async () => {
  const d = last(3);
  const r = await put(d, { total: 5, trial_names: [], guests: "x" });
  expect(r.status).toBe(422);
  expect(await r.json()).toEqual({ detail: "Ungültige Eingabe." });
  const r2 = await call("/api/vacations", { as: EMAIL, json: { start_date: "2026-03-05", end_date: "2026-03-03" } });
  expect(r2.status).toBe(422);
  expect(((await r2.json()) as any).detail).toBe("Ende liegt vor dem Beginn");
});
