import { beforeEach, expect, it } from "vitest";
import { addUser, call, resetDb } from "./helpers";

const A = "boss@example.com";
const T = "t@example.com";
const ROUNDS = { rounds: 5, work: 300, rest: 30, prep: 10 };
const body = (o: Record<string, unknown> = {}) => ({ name: "Rolling", mode: "rounds", config: ROUNDS, ...o });
beforeEach(async () => {
  await resetDb();
  await addUser({ email: A, role: "gesellschafter" });
  await addUser({ email: T, role: "trainer" });
});
const post = (json: unknown, as = A) => call("/api/timer-presets", { as, json });
const list = async (as = A) => (await (await call("/api/timer-presets", { as })).json()) as any[];

it("trainer reads but cannot write (test_trainer_reads_but_cannot_write)", async () => {
  const pid = ((await (await post(body())).json()) as any).id;
  expect(await list(T)).toHaveLength(1);
  expect((await post(body(), T)).status).toBe(403);
  expect((await call(`/api/timer-presets/${pid}`, { as: T, method: "PATCH", json: { name: "x" } })).status).toBe(403);
  expect((await call(`/api/timer-presets/${pid}`, { as: T, method: "DELETE" })).status).toBe(403);
  expect(await list()).toHaveLength(1);
});

it("admin crud (test_admin_crud)", async () => {
  const created = await post(body());
  expect(created.status).toBe(201);
  const cj = (await created.json()) as any;
  expect(cj).toEqual({ id: expect.any(Number), name: "Rolling", mode: "rounds", config: ROUNDS, sort_order: 0 });
  const pid = cj.id;
  const r = await call(`/api/timer-presets/${pid}`, { as: A, method: "PATCH", json: { name: "Neu" } });
  expect(((await r.json()) as any).name).toBe("Neu");
  const del = await call(`/api/timer-presets/${pid}`, { as: A, method: "DELETE" });
  expect(del.status).toBe(204);
  expect(await list()).toEqual([]);
  const again = await call(`/api/timer-presets/${pid}`, { as: A, method: "DELETE" });
  expect(again.status).toBe(404);
  expect(await again.json()).toEqual({ detail: "Preset nicht gefunden." });
});

it.each([
  { ...ROUNDS, rounds: 0 }, { ...ROUNDS, rounds: 100 }, { ...ROUNDS, work: 6000 },
  { ...ROUNDS, rest: -1 }, { ...ROUNDS, extra: 1 }, { duration: 5 },
])("rounds config validated (test_rounds_config_validated) %j", async (cfg) => {
  const r = await post(body({ config: cfg }));
  expect(r.status).toBe(422);
  expect(typeof ((await r.json()) as any).detail).toBe("string");
});

it("limits accepted and pause zero (test_limits_accepted_and_pause_zero)", async () => {
  expect((await post(body({ config: { rounds: 99, work: 5999, rest: 0, prep: 0 } }))).status).toBe(201);
});

it("prep defaults to 10; countdown and stopwatch bodies", async () => {
  const r = await post(body({ config: { rounds: 3, work: 60, rest: 0 } }));
  expect(((await r.json()) as any).config).toEqual({ rounds: 3, work: 60, rest: 0, prep: 10 });
  expect(((await (await post(body({ name: "C", mode: "countdown", config: { duration: 300 } }))).json()) as any).config).toEqual({ duration: 300 });
  expect(((await (await post(body({ name: "S", mode: "stopwatch", config: {} }))).json()) as any).config).toEqual({});
  expect((await post(body({ mode: "stopwatch", config: { x: 1 } }))).status).toBe(422);
  expect((await post(body({ mode: "countdown", config: { duration: 6000 } }))).status).toBe(422);
  expect((await post(body({ name: " " }))).status).toBe(422);
});

it("list ordered by sort_order, id", async () => {
  await post(body({ name: "b", sort_order: 2 }));
  await post(body({ name: "a", sort_order: 1 }));
  await post(body({ name: "c", sort_order: 1 }));
  expect((await list()).map((p) => p.name)).toEqual(["a", "c", "b"]);
});

it("patch mode/config mismatch (test_patch_mode_config_mismatch)", async () => {
  const pid = ((await (await post(body())).json()) as any).id;
  const patch = (json: unknown) => call(`/api/timer-presets/${pid}`, { as: A, method: "PATCH", json });
  const bad = await patch({ mode: "countdown" });
  expect(bad.status).toBe(422);
  expect(await bad.json()).toEqual({ detail: "Konfiguration passt nicht zum Modus." });
  expect((await list())[0].mode).toBe("rounds");
  const ok = await patch({ mode: "countdown", config: { duration: 300 } });
  expect(ok.status).toBe(200);
  expect(((await ok.json()) as any).config).toEqual({ duration: 300 });
  const nul = await patch({ name: null });
  expect(nul.status).toBe(422);
  expect(await nul.json()).toEqual({ detail: "Felder dürfen nicht null sein." });
  expect((await call("/api/timer-presets/9999", { as: A, method: "PATCH", json: { name: "x" } })).status).toBe(404);
});
