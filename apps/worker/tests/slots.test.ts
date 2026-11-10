import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { listSlotsWithTrainers } from "../src/slots";
import { addSlot, addUser, call, resetDb } from "./helpers";

const A = "boss@example.com";
const T = "t@example.com";
const SLOT = { weekday: 2, start_time: "18:00:00", end_time: "19:00:00", kind: "gi" };
beforeEach(async () => {
  await resetDb();
  await addUser({ email: A, role: "gesellschafter" });
  await addUser({ email: T, role: "trainer" });
});
const post = (json: unknown, as = A) => call("/api/slots", { as, json });
const get = async (path: string, as = A) => (await (await call(path, { as })).json()) as any[];

it("trainer cannot write slots (test_trainer_cannot_write, slots part)", async () => {
  expect((await call("/api/slots", { as: T })).status).toBe(200);
  expect((await post(SLOT, T)).status).toBe(403);
  expect((await call("/api/slots/1", { as: T, method: "PATCH", json: { active: false } })).status).toBe(403);
  expect((await call("/api/slots/1/trainers", { as: T, method: "PUT", json: { user_ids: [] } })).status).toBe(403);
});

it("slot crud and sorting (test_slot_crud_and_sorting)", async () => {
  for (const [weekday, start_time] of [[5, "19:00:00"], [2, "18:00:00"], [5, "08:00:00"]] as const) {
    expect((await post({ ...SLOT, weekday, start_time, end_time: "23:00:00" })).status).toBe(201);
  }
  const order = (await get("/api/slots")).map((s) => [s.weekday, s.start_time]);
  expect(order).toEqual([[2, "18:00:00"], [5, "08:00:00"], [5, "19:00:00"]]);
  const dup = await post({ ...SLOT, weekday: 5, start_time: "08:00:00", end_time: "09:00:00" });
  expect(dup.status).toBe(409);
  expect(await dup.json()).toEqual({ detail: "Dieser Slot existiert bereits." });
});

it("create returns SlotOut shape; short times are normalised", async () => {
  const r = await post({ weekday: 1, start_time: "9:00".padStart(5, "0"), end_time: "10:30", kind: "open_mat", sort_order: 3 });
  expect(await r.json()).toEqual({ id: expect.any(Number), weekday: 1, start_time: "09:00:00", end_time: "10:30:00", kind: "open_mat", active: true, sort_order: 3, location: null, trainers: [] });
});

it("slot location create/patch/default (test_slot_location_create_patch_and_default)", async () => {
  const plain = await (await post(SLOT)).json() as any;
  expect(plain.location).toBeNull();
  const created = await (await post({ ...SLOT, weekday: 3, location: "Rheinheim" })).json() as any;
  expect(created.location).toBe("Rheinheim");
  const patch = (json: unknown) => call(`/api/slots/${plain.id}`, { as: A, method: "PATCH", json });
  let r = await patch({ location: "Rheinheim" });
  expect(r.status).toBe(200);
  expect(((await r.json()) as any).location).toBe("Rheinheim");
  r = await patch({ location: "" });
  expect(r.status).toBe(200);
  expect(((await r.json()) as any).location).toBeNull();
  r = await patch({ location: "x".repeat(60) });
  expect(((await r.json()) as any).location).toBe("x".repeat(50));
  r = await patch({ location: null });
  expect(((await r.json()) as any).location).toBeNull();
  expect(((await (await post({ ...SLOT, weekday: 4, location: "  " })).json()) as any).location).toBeNull();
});

it("slot validation (test_slot_validation)", async () => {
  expect((await post({ ...SLOT, weekday: 8 })).status).toBe(422);
  const r = await post({ ...SLOT, end_time: "17:00:00" });
  expect(r.status).toBe(422);
  expect(typeof ((await r.json()) as any).detail).toBe("string");
  expect((await post({ ...SLOT, kind: "yoga" })).status).toBe(422);
  expect((await post({ ...SLOT, start_time: "25:00:00" })).status).toBe(422);
});

it("patch: end before start, nulls, unknown id, unique", async () => {
  const id = ((await (await post(SLOT)).json()) as any).id;
  const other = ((await (await post({ ...SLOT, start_time: "20:00:00", end_time: "21:00:00" })).json()) as any).id;
  const patch = (i: number, json: unknown) => call(`/api/slots/${i}`, { as: A, method: "PATCH", json });
  let r = await patch(id, { end_time: "17:00:00" });
  expect(r.status).toBe(422);
  expect(await r.json()).toEqual({ detail: "Ende muss nach dem Beginn liegen." });
  expect(((await get("/api/slots"))[0]).end_time).toBe("19:00:00");
  r = await patch(id, { kind: null });
  expect(r.status).toBe(422);
  expect(await r.json()).toEqual({ detail: "Felder dürfen nicht null sein." });
  expect((await patch(id, { weekday: 9 })).status).toBe(422);
  r = await patch(9999, { active: false });
  expect(r.status).toBe(404);
  expect(await r.json()).toEqual({ detail: "Slot nicht gefunden." });
  r = await patch(other, { start_time: "18:00:00" });
  expect(r.status).toBe(409);
  expect(await r.json()).toEqual({ detail: "Dieser Slot existiert bereits." });
});

it("deactivate hides slot from trainer (test_deactivate_hides_slot_from_trainer)", async () => {
  const sid = ((await (await post(SLOT)).json()) as any).id;
  expect((await call(`/api/slots/${sid}`, { as: A, method: "PATCH", json: { active: false } })).status).toBe(200);
  expect(await get("/api/slots", T)).toEqual([]);
  expect(await get("/api/slots?include_inactive=true", T)).toHaveLength(0);
  expect(await get("/api/slots?include_inactive=true")).toHaveLength(1);
});

it("set trainers (test_set_trainers)", async () => {
  const sid = ((await (await post(SLOT)).json()) as any).id;
  const t = await addUser({ email: "tr@example.com", role: "trainer", is_trainer: true });
  const put = (user_ids: number[]) => call(`/api/slots/${sid}/trainers`, { as: A, method: "PUT", json: { user_ids } });
  let r = await put([t]);
  expect(((await r.json()) as any).trainers).toEqual([{ id: t, display_name: "tr" }]);
  const nt = await addUser({ email: "nt@example.com", role: "trainer", is_trainer: false });
  r = await put([nt]);
  expect(r.status).toBe(422);
  expect(await r.json()).toEqual({ detail: `Keine aktiven Trainer: [${nt}]` });
  // rejected request leaves previous assignment intact
  expect(((await get("/api/slots"))[0]).trainers).toHaveLength(1);
  expect(((await (await put([])).json()) as any).trainers).toEqual([]);
  expect((await put([9999])).status).toBe(422);
  const many = await put(Array.from({ length: 51 }, (_, i) => i + 1));
  expect(many.status).toBe(422);
  expect(await many.json()).toEqual({ detail: "Zu viele Trainer." });
  expect((await call("/api/slots/9999/trainers", { as: A, method: "PUT", json: { user_ids: [] } })).status).toBe(404);
});

it("set trainers dedupes ids and orders by id", async () => {
  const sid = addSlotId(await addSlot({ weekday: 1, start_time: "10:00:00", end_time: "11:00:00" }));
  const a = await addUser({ email: "a@example.com", is_trainer: true });
  const b = await addUser({ email: "b@example.com", is_trainer: true });
  const r = await call(`/api/slots/${sid}/trainers`, { as: A, method: "PUT", json: { user_ids: [b, a, b] } });
  expect(((await r.json()) as any).trainers.map((x: any) => x.id)).toEqual([a, b]);
});
const addSlotId = (n: number) => n;

it("listSlotsWithTrainers: ordering, includeInactive, trainer fields", async () => {
  const t2 = await addUser({ email: "t2@example.com", name: "Two", is_trainer: true });
  const t1 = await addUser({ email: "t1@example.com", name: "One", is_trainer: true, active: false });
  await addSlot({ weekday: 3, start_time: "10:00:00", end_time: "11:00:00", kind: "gi", sort_order: 1 });
  const s = await addSlot({ weekday: 1, start_time: "10:00:00", end_time: "11:00:00", trainers: [t2, t1] });
  await addSlot({ weekday: 1, start_time: "10:00:00", end_time: "11:00:00", kind: "gi", sort_order: 0, active: false });
  const act = await listSlotsWithTrainers(env.DB);
  expect(act.map((x) => x.weekday)).toEqual([1, 3]);
  expect(act[0]).toMatchObject({ id: s, active: true, location: null });
  expect(act[0]!.trainers).toEqual([
    { id: t2, display_name: "Two", active: true, is_trainer: true },
    { id: t1, display_name: "One", active: false, is_trainer: true },
  ]);
  const everything = await listSlotsWithTrainers(env.DB, { includeInactive: true });
  expect(everything).toHaveLength(3);
});
