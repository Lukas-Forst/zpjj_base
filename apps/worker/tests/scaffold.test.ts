import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { addSlot, call, resetDb } from "./helpers";

beforeEach(resetDb);

const att = (cols: string, vals: unknown[]) =>
  env.DB.prepare(`INSERT INTO attendance (date, cancelled, ${cols}, updated_at) VALUES ('2026-01-05', 0, ${vals.map(() => "?").join(",")}, 'x')`).bind(...vals).run();

describe("app", () => {
  it("healthz", async () => {
    const r = await call("/healthz");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(r.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(r.headers.get("Strict-Transport-Security")).toBeTruthy();
  });
  it("non-api path goes to the assets binding", async () => {
    const r = await call("/index.html");
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("stub-assets");
  });
  it("unknown api route is 404 with detail", async () => {
    const r = await call("/api/nope");
    expect(r.status).toBe(404);
    expect(typeof ((await r.json()) as { detail: string }).detail).toBe("string");
  });
});

describe("schema", () => {
  it("attendance rejects trials + guests > total", async () => {
    await expect(att("total, trials, guests", [5, 4, 2])).rejects.toThrow();
    await att("total, trials, guests", [6, 4, 2]);
  });
  it("attendance rejects negatives", async () => {
    await expect(att("total, trials", [3, -1])).rejects.toThrow();
  });
  it("trials.name_key is unique", async () => {
    const ins = () => env.DB.prepare("INSERT INTO trials (name, name_key, first_date) VALUES ('A','a','2026-01-05')").run();
    await ins();
    await expect(ins()).rejects.toThrow();
  });
  it("trials status is constrained, defaults to offen", async () => {
    await env.DB.prepare("INSERT INTO trials (name, name_key, first_date) VALUES ('A','a','2026-01-05')").run();
    expect((await env.DB.prepare("SELECT status FROM trials").first<{ status: string }>())?.status).toBe("offen");
    await expect(env.DB.prepare("UPDATE trials SET status='x'").run()).rejects.toThrow();
  });
  it("slots accept a location", async () => {
    const id = await addSlot({ weekday: 1, start_time: "18:00:00", end_time: "19:00:00", location: "Rheinheim" });
    expect((await env.DB.prepare("SELECT location FROM slots WHERE id=?").bind(id).first<{ location: string }>())?.location).toBe("Rheinheim");
  });
  it("foreign keys reject trial_attendance for unknown trial", async () => {
    await att("trials", [0]);
    await expect(env.DB.prepare("INSERT INTO trial_attendance (trial_id, date) VALUES (999, '2026-01-05')").run()).rejects.toThrow();
  });
  it("vacations reject end before start", async () => {
    await env.DB.prepare("INSERT INTO users (email, display_name, role, is_trainer, active, created_at, updated_at) VALUES ('a@x.de','A','trainer',1,1,'x','x')").run();
    await expect(env.DB.prepare("INSERT INTO vacations (user_id, start_date, end_date, source, created_at, updated_at) VALUES (1,'2026-02-02','2026-02-01','base','x','x')").run()).rejects.toThrow();
  });
});
