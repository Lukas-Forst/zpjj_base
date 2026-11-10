import { beforeEach, expect, it } from "vitest";
import { addUser, call, resetDb } from "./helpers";

const A = "boss@example.com";
beforeEach(async () => {
  await resetDb();
  await addUser({ email: A, role: "gesellschafter" });
});

it("trainer cannot use user endpoints (test_trainer_cannot_write, users part)", async () => {
  await addUser({ email: "t@example.com", role: "trainer" });
  const as = "t@example.com";
  expect((await call("/api/users", { as })).status).toBe(403);
  expect((await call("/api/users", { as, json: { email: "x@e.com", display_name: "X" } })).status).toBe(403);
  expect((await call("/api/users/1", { as, method: "PATCH", json: { active: false } })).status).toBe(403);
});

it("users crud (test_users_crud)", async () => {
  const r = await call("/api/users", { as: A, json: { email: " New@Example.com ", display_name: "N" } });
  expect(r.status).toBe(201);
  const u = (await r.json()) as Record<string, unknown>;
  expect(u).toMatchObject({ email: "new@example.com", role: "trainer", is_trainer: true, active: true, display_name: "N" });
  expect((await call("/api/users", { as: A, json: { email: "new@example.com", display_name: "N" } })).status).toBe(409);
  const dup = await call("/api/users", { as: A, json: { email: "new@example.com", display_name: "N" } });
  expect(await dup.json()).toEqual({ detail: "E-Mail-Adresse existiert bereits." });
  const bad = await call("/api/users", { as: A, json: { email: "bad", display_name: "N" } });
  expect(bad.status).toBe(422);
  expect(typeof ((await bad.json()) as { detail: unknown }).detail).toBe("string");
  const p = await call(`/api/users/${u.id}`, { as: A, method: "PATCH", json: { active: false } });
  expect(((await p.json()) as { active: boolean }).active).toBe(false);
});

it("list is ordered by display_name (binary collation), id and shows UserOut fields", async () => {
  await addUser({ email: "z@example.com", name: "Zed" });
  await addUser({ email: "a@example.com", name: "Abe" });
  const l = (await (await call("/api/users", { as: A })).json()) as { display_name: string }[];
  expect(l.map((x) => x.display_name)).toEqual(["Abe", "Zed", "boss"]);
  expect(Object.keys(l[0]!).sort()).toEqual(["active", "display_name", "email", "id", "is_trainer", "role"]);
});

it("validation: name, email, null fields, unknown user", async () => {
  expect((await call("/api/users", { as: A, json: { email: "a@b.de", display_name: "  " } })).status).toBe(422);
  expect((await call("/api/users", { as: A, json: { email: "a@b.de", display_name: "x".repeat(101) } })).status).toBe(422);
  expect((await call("/api/users", { as: A, json: { email: "@b.de", display_name: "x" } })).status).toBe(422);
  const id = await addUser({ email: "q@example.com" });
  const r = await call(`/api/users/${id}`, { as: A, method: "PATCH", json: { role: null } });
  expect(r.status).toBe(422);
  expect(await r.json()).toEqual({ detail: "role/active dürfen nicht null sein." });
  const n = await call("/api/users/9999", { as: A, method: "PATCH", json: { active: false } });
  expect(n.status).toBe(404);
  expect(await n.json()).toEqual({ detail: "Nutzer nicht gefunden." });
  const ok = await call(`/api/users/${id}`, { as: A, method: "PATCH", json: { display_name: " Neu ", is_trainer: false } });
  expect(await ok.json()).toMatchObject({ display_name: "Neu", is_trainer: false });
});

it("last gesellschafter protected (test_last_gesellschafter_protected)", async () => {
  const me = ((await (await call("/api/me", { as: A })).json()) as { id: number }).id;
  const patch = (id: number, json: unknown) => call(`/api/users/${id}`, { as: A, method: "PATCH", json });
  expect((await patch(me, { active: false })).status).toBe(409);
  const r = await patch(me, { role: "trainer" });
  expect(r.status).toBe(409);
  expect(await r.json()).toEqual({ detail: "Der letzte aktive Gesellschafter kann nicht deaktiviert oder herabgestuft werden." });
  const other = await addUser({ email: "o@example.com", role: "gesellschafter" });
  expect((await patch(me, { role: "trainer" })).status).toBe(200);
  // caller is now a trainer: the guard fires before the last-admin rule
  expect((await patch(other, { active: false })).status).toBe(403);
});
