import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { buildSeedSql, EXAMPLE_PRESETS } from "../src/seedSql";
import { resetDb } from "./helpers";

type U = { email: string; display_name: string; role: "gesellschafter" | "trainer"; is_trainer: boolean };
const USERS: U[] = ["Nico", "Can", "Tim", "Chris", "Lukas"].map((n) => ({
  email: `${n.toLowerCase()}@example.com`, display_name: n, role: "trainer", is_trainer: true,
}));
const run = (sql: string) => env.DB.exec(sql);
const rows = async <T>(sql: string) => (await env.DB.prepare(sql).all<T>()).results;
const trainers = async (where: string) =>
  (await rows<{ n: string }>(
    `SELECT u.display_name n FROM slots s JOIN slot_trainers st ON st.slot_id=s.id JOIN users u ON u.id=st.user_id WHERE ${where} ORDER BY u.display_name`,
  )).map((r) => r.n);

beforeEach(resetDb);

// pytest test_api.py::test_seed_idempotent_and_correct
describe("seed", () => {
  it("is idempotent and correct", async () => {
    const sql = buildSeedSql(USERS);
    await run(sql);
    await run(sql);
    expect(await rows("SELECT id FROM slots")).toHaveLength(12);
    expect(await rows("SELECT id FROM users")).toHaveLength(5);
    expect(await trainers("s.weekday=5 AND s.kind='gi'")).toEqual(["Can", "Tim"]);
    expect(await rows("SELECT id FROM slots s JOIN slot_trainers st ON st.slot_id=s.id WHERE s.kind='open_mat'")).toEqual([]);
    expect(await trainers("s.weekday=3 AND s.location IS NULL")).toEqual(["Chris"]);
    const rh = await rows("SELECT weekday, substr(start_time,1,5) st, substr(end_time,1,5) et, kind FROM slots WHERE location='Rheinheim' ORDER BY weekday");
    expect(rh).toEqual([{ weekday: 1, st: "19:30", et: "21:30", kind: "no_gi" }, { weekday: 3, st: "19:30", et: "21:30", kind: "no_gi" }]);
    expect(await trainers("s.location='Rheinheim' AND s.weekday=1")).toEqual(["Nico"]);
    expect(await trainers("s.location='Rheinheim' AND s.weekday=3")).toEqual(["Tim"]);
  });

  // pytest test_api.py::test_seed_aborts_cleanly (missing-file part lives in the CLI)
  it("aborts before emitting SQL on an unknown trainer", async () => {
    expect(() => buildSeedSql([{ ...USERS[0] }])).toThrow(/Can/);
    expect(await rows("SELECT id FROM slots")).toEqual([]);
  });

  it("never touches existing slots or their trainers", async () => {
    await run(buildSeedSql(USERS));
    await env.DB.exec("DELETE FROM slot_trainers WHERE slot_id IN (SELECT id FROM slots WHERE weekday=5 AND kind='gi')");
    await run(buildSeedSql(USERS));
    expect(await trainers("s.weekday=5 AND s.kind='gi'")).toEqual([]);
  });

  // pytest test_presets.py::test_seed_presets_idempotent
  it("seeds the example presets once", async () => {
    const sql = buildSeedSql(USERS);
    await run(sql);
    await run(sql);
    const p = await rows<{ name: string; config: string }>("SELECT name, config FROM timer_presets ORDER BY sort_order");
    expect(p).toHaveLength(EXAMPLE_PRESETS.length);
    expect(p.every((x) => x.name.includes("(Beispiel)"))).toBe(true);
    expect(JSON.parse(p[3].config)).toEqual({ duration: 300 });
  });

  it("escapes quotes in names", async () => {
    await run(buildSeedSql([...USERS, { email: "o@example.com", display_name: "O'Neil", role: "trainer", is_trainer: false }]));
    expect(await rows("SELECT id FROM users WHERE display_name = 'O''Neil'")).toHaveLength(1);
  });
});
