import { beforeEach, expect, it } from "vitest";
import { addUser, call, resetDb } from "./helpers";

beforeEach(resetDb);

it("/api/me returns MeOut fields only", async () => {
  const id = await addUser({ email: "t@example.com", name: "T", role: "trainer", is_trainer: true });
  const r = await call("/api/me", { as: "t@example.com" });
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ id, display_name: "T", role: "trainer", is_trainer: true });
});

it("unknown or inactive test user gets 403, no header 401", async () => {
  await addUser({ email: "i@example.com", active: false });
  expect((await call("/api/me", { as: "i@example.com" })).status).toBe(403);
  expect((await call("/api/me", { as: "who@example.com" })).status).toBe(403);
  expect((await call("/api/me")).status).toBe(401);
});
