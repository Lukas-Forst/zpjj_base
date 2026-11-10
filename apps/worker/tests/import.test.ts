import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { addUser, call, resetDb } from "./helpers";
import { buildImportSql, type ImportInput } from "../src/importSql";

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const run = (sql: string) => env.DB.exec(sql);
const rows = async <T>(sql: string) => (await env.DB.prepare(sql).all<T>()).results;
const count = async (t: string) => (await rows<{ c: number }>(`SELECT count(*) c FROM ${t}`))[0].c;

const input = (): ImportInput => ({
  training: [
    ["Datum", "", "", "", "Kursart", "", "Gesamt", "Probe", "", "", "Namen"],
    [D("2025-01-07"), null, null, null, "BJJ", null, 10, 1, null, null, "Nathan"],
    [D("2025-01-12"), null, null, null, "Open Mat", null, 6, null],
    [D("2025-01-14"), null, null, null, "BJJ", null, null, null],
  ],
  probe: [["Name", "Erstes", "Zweites"], ["nathan", D("2025-01-07"), D("2025-01-20")]],
});

beforeEach(resetDb);

describe("import", () => {
  // test_import_excel.py::test_import_is_idempotent
  it("is idempotent", async () => {
    const r = buildImportSql(input());
    expect([r.days, r.skipped, r.trials]).toEqual([2, 1, 1]);
    await run(r.sql);
    await run(r.sql);
    const om = (await rows<{ open_mat: number; total: number | null; updated_by: number | null }>("SELECT * FROM attendance WHERE date='2025-01-12'"))[0];
    expect(om.open_mat).toBe(6);
    expect(om.total).toBeNull();
    expect(om.updated_by).toBeNull();
    expect(await rows("SELECT 1 FROM attendance WHERE date='2025-01-14'")).toEqual([]);
    expect((await rows<{ trials: number }>("SELECT trials FROM attendance WHERE date='2025-01-07'"))[0].trials).toBe(1);
    expect(await count("trial_attendance")).toBe(1);
    expect(await count("attendance")).toBe(2);
    expect((await rows<{ first_date: string }>("SELECT first_date FROM trials"))[0].first_date).toBe("2025-01-07");
  });

  // test_import_excel.py::test_existing_day_untouched
  it("leaves an existing day and its links alone", async () => {
    await env.DB.exec("INSERT INTO attendance (date,total,trials,updated_at) VALUES ('2025-01-07',99,0,'x')");
    const r = buildImportSql(input());
    await run(r.sql);
    expect((await rows<{ total: number }>("SELECT total FROM attendance WHERE date='2025-01-07'"))[0].total).toBe(99);
    expect(await count("trial_attendance")).toBe(0);
  });

  // test_import_excel.py::test_import_maps_member_status
  it("maps member status", async () => {
    const i = input();
    i.probe = [
      ["Name", "Erstes", "Zweites", "Angemeldet?", "Anmeldedatum", "Q", "T", "Status"],
      ["Ana", D("2025-01-07"), null, null, D("2025-02-01"), null, null, "Mitglied geworden"],
      ["Ben", D("2025-01-08"), null, "Ja", null],
      ["Cem", D("2025-01-09"), null, "Nein", null, null, null, "Offen"],
    ];
    const sql = buildImportSql(i).sql;
    await run(sql);
    const st = () => rows<{ name: string; status: string; member_since: string | null }>("SELECT name,status,member_since FROM trials ORDER BY name");
    const first = await st();
    expect(first).toEqual([
      { name: "Ana", status: "mitglied", member_since: "2025-02-01" },
      { name: "Ben", status: "mitglied", member_since: "2025-01-08" },
      { name: "Cem", status: "offen", member_since: null },
      { name: "Nathan", status: "offen", member_since: null },
    ]);
    await run(sql);
    expect(await st()).toEqual(first);
    await env.DB.exec("UPDATE trials SET status='zahlt_pro_besuch' WHERE name='Cem'");
    await run(sql);
    expect((await rows<{ status: string }>("SELECT status FROM trials WHERE name='Cem'"))[0].status).toBe("zahlt_pro_besuch");
  });

  it("trial count is min(H, G); rows without count skipped, never 0", () => {
    const r = buildImportSql({ training: [["h"], [D("2025-03-04"), null, null, null, "BJJ", null, 3, 9], [D("2025-03-05"), null, null, null, "BJJ", null, null, 2], [null, null]], probe: [] });
    expect([r.days, r.skipped]).toEqual([1, 1]);
    expect(r.sql).toContain("3, 3");
  });

  it("existing trial: first_date lowered, others kept", async () => {
    await env.DB.exec("INSERT INTO trials (name,name_key,first_date) VALUES ('Nathan','nathan','2025-05-01')");
    await run(buildImportSql(input()).sql);
    expect(await rows("SELECT name, first_date FROM trials")).toEqual([{ name: "Nathan", first_date: "2025-01-07" }]);
  });

  it("umlaut/ß name typed in the API and imported via SQL is ONE person", async () => {
    await addUser({ email: "t@example.com" });
    await env.DB.exec("INSERT INTO slots (weekday,start_time,end_time,kind) VALUES (2,'18:00:00','20:00:00','no_gi')");
    const r = await call("/api/attendance/2025-01-14", { as: "t@example.com", method: "PUT", json: { cancelled: false, total: 5, trial_names: ["Jürgen Weiß"], guests: 0 } });
    expect(r.status).toBe(200);
    const i = input();
    i.training.push([D("2025-01-21"), null, null, null, "BJJ", null, 8, 1, null, null, "JÜRGEN WEISS"]);
    await run(buildImportSql(i).sql);
    expect(await rows("SELECT name FROM trials WHERE name_key LIKE 'j%'")).toHaveLength(1);
  });
});
