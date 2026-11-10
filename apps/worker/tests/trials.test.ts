import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { addDays, todayBerlin } from "../src/dates";
import { addUser, call, resetDb } from "./helpers";

const EMAIL = "t@example.com";
beforeEach(async () => {
  await resetDb();
  await addUser({ email: EMAIL });
});
async function person(name: string, daysAgo: number[], status = "offen"): Promise<number> {
  const ds = daysAgo.map((n) => addDays(todayBerlin(), -n));
  const r = await env.DB.prepare("INSERT INTO trials (name, name_key, first_date, status) VALUES (?,?,?,?)")
    .bind(name, name.toLowerCase(), [...ds].sort()[0], status).run();
  const id = r.meta.last_row_id;
  for (const d of ds) {
    await env.DB.prepare("INSERT OR IGNORE INTO attendance (date, total, updated_at) VALUES (?,10,'x')").bind(d).run();
    await env.DB.prepare("INSERT OR IGNORE INTO trial_attendance (trial_id, date) VALUES (?,?)").bind(id, d).run();
  }
  return id;
}
const patch = (id: number | string, json: object, as: string | undefined = EMAIL) => call(`/api/trials/${id}`, { method: "PATCH", as, json });

it("list flags due and recent (test_list_flags_due_and_recent)", async () => {
  await person("B", [42, 45]);
  await person("C", [1, 3, 5], "mitglied");
  await person("A", [1, 9]);
  await person("D", [2]);
  const rows = (await (await call("/api/trials", { as: EMAIL })).json()) as any[];
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  expect(by.A).toMatchObject({ due: true, recent: true, visits: 2 });
  expect(by.B).toMatchObject({ recent: false, due: true });
  expect(by.C).toMatchObject({ visits: 3, due: false });
  expect(by.D).toMatchObject({ visits: 1, due: false });
  expect(rows.map((r) => r.name)).toEqual(["A", "B", "C", "D"]);
});
it("last_visit, recent boundary and ordering tiebreak (new)", async () => {
  await person("Zed", [3]);
  await person("anna", [3]);
  await person("Old", [28]);
  await person("Older", [29]);
  await env.DB.prepare("INSERT INTO trials (name, name_key, first_date) VALUES ('Never','never','2026-01-01')").run();
  const rows = (await (await call("/api/trials", { as: EMAIL })).json()) as any[];
  expect(rows.map((r) => r.name)).toEqual(["anna", "Zed", "Old", "Older", "Never"]);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  expect(by.Old.recent).toBe(true);
  expect(by.Older.recent).toBe(false);
  expect(by.Never).toMatchObject({ visits: 0, last_visit: null, recent: false, due: false });
  expect(by.Zed.last_visit).toBe(addDays(todayBerlin(), -3));
});
it("patch member sets member_since and clears on revert (test_patch_member_sets_member_since_and_clears_on_revert)", async () => {
  const id = await person("A", [1, 9]);
  let r = await patch(id, { status: "mitglied" });
  expect(r.status).toBe(200);
  let j = (await r.json()) as any;
  expect(j.status).toBe("mitglied");
  expect(j.member_since).toBe(todayBerlin());
  expect(j).toMatchObject({ visits: 2, due: false });
  r = await patch(id, { status: "mitglied", member_since: "2026-01-05" });
  expect(((await r.json()) as any).member_since).toBe("2026-01-05");
  r = await patch(id, { status: "offen" });
  j = (await r.json()) as any;
  expect([j.status, j.member_since]).toEqual(["offen", null]);
  j = (await (await patch(id, { status: "zahlt_pro_besuch", member_since: "2026-01-05" })).json()) as any;
  expect([j.status, j.member_since]).toEqual(["zahlt_pro_besuch", null]);
});
it("patch unknown and invalid (test_patch_unknown_and_invalid)", async () => {
  const r = await patch(999, { status: "offen" });
  expect(r.status).toBe(404);
  expect(((await r.json()) as any).detail).toBe("Person nicht gefunden.");
  const id = await person("A", [1]);
  const bad = await patch(id, { status: "x" });
  expect(bad.status).toBe(422);
  expect(typeof ((await bad.json()) as any).detail).toBe("string");
  expect((await patch(id, { status: "mitglied", member_since: "nope" })).status).toBe(422);
  expect((await patch("abc", { status: "offen" })).status).toBe(422);
});
it("trials require login (test_trials_require_login)", async () => {
  expect((await call("/api/trials")).status).toBe(401);
  expect((await call("/api/trials/1", { method: "PATCH", json: { status: "offen" } })).status).toBe(401);
});
it("name tiebreak compares by code point like Python casefold (new)", async () => {
  for (const n of ["jürgen", "jz", "jan"]) await person(n, [3]);
  const rows = (await (await call("/api/trials", { as: EMAIL })).json()) as any[];
  expect(rows.map((r) => r.name)).toEqual(["jan", "jz", "jürgen"]);
});
