import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { all } from "../db";
import { addDays, isoWeekday, todayBerlin } from "../dates";
import { overviewAverages, statsFrom, statsSince } from "../stats";
import { toAttendanceOut, saveDay, validateEntry } from "../attendance";
import { DateIn } from "../schemas/common";
import type { AppEnv } from "../types";

const AttendanceIn = z
  .object({
    cancelled: z.boolean().default(false),
    total: z.number().int().nullish(),
    trial_names: z.array(z.string()).default([]),
    guests: z.number().int().default(0),
    open_mat: z.number().int().nullish(),
    beginner: z.number().int().nullish(),
  })
  .openapi("AttendanceIn");
const AttendanceOut = z
  .object({
    date: z.string(), cancelled: z.boolean(), total: z.number().int().nullable(), trials: z.number().int(),
    guests: z.number().int(), members: z.number().int().nullable(), open_mat: z.number().int().nullable(),
    beginner: z.number().int().nullable(), names: z.array(z.string()), updated_by_name: z.string().nullable(),
    updated_at: z.string(),
  })
  .openapi("AttendanceOut");
const json = <S extends z.ZodType>(schema: S) => ({ "application/json": { schema } });

const WeekdayAvg = z.object({ weekday: z.number().int(), avg: z.number().nullable() }).openapi("WeekdayAvg");
const AttendanceOverview = z
  .object({ entries: z.array(AttendanceOut), avg_14d: z.number().nullable(), avg_by_weekday: z.array(WeekdayAvg) })
  .openapi("AttendanceOverview");
const MissingOut = z.object({ date: z.string().nullable() }).openapi("MissingOut");
const WeekPoint = z.object({ week_start: z.string(), avg: z.number().nullable(), days: z.number().int() }).openapi("WeekPoint");
const StatsOut = z
  .object({ months: z.number().int(), weeks: z.array(WeekPoint), weekday_avg: z.array(WeekdayAvg) })
  .openapi("StatsOut");

type Row = { date: string; total: number | null; cancelled: number };

export const attendance = new OpenAPIHono<AppEnv>()
  .openapi(
    createRoute({
      method: "get",
      path: "/attendance",
      request: { query: z.object({ days: z.coerce.number().int().min(1).max(400).default(60) }) },
      responses: { 200: { description: "Übersicht", content: json(AttendanceOverview) } },
    }),
    async (c) => {
      const db = c.env.DB;
      const today = todayBerlin();
      const from = addDays(today, -c.req.valid("query").days);
      const [rows, links] = await Promise.all([
        all<Record<string, any>>(
          db,
          `SELECT a.*, u.display_name AS updated_by_name FROM attendance a LEFT JOIN users u ON u.id = a.updated_by ORDER BY a.date DESC`,
        ),
        all<{ date: string; name: string }>(
          db,
          `SELECT ta.date, t.name FROM trial_attendance ta JOIN trials t ON t.id = ta.trial_id WHERE ta.date >= ? ORDER BY t.name`,
          from,
        ),
      ]);
      const names = new Map<string, string[]>();
      for (const l of links) names.set(l.date, [...(names.get(l.date) ?? []), l.name]);
      const entries = rows
        .filter((a) => a.date >= from)
        .map((a) => ({
          date: a.date, cancelled: !!a.cancelled, total: a.total, trials: a.trials, guests: a.guests,
          members: a.total === null ? null : a.total - a.trials - a.guests,
          open_mat: a.open_mat, beginner: a.beginner, names: names.get(a.date) ?? [],
          updated_by_name: a.updated_by_name, updated_at: a.updated_at,
        }));
      return c.json({ entries, ...overviewAverages(rows as Row[], today) }, 200);
    },
  )
  .openapi(
    createRoute({ method: "get", path: "/attendance/missing", responses: { 200: { description: "Fehlender Tag", content: json(MissingOut) } } }),
    async (c) => {
      const db = c.env.DB;
      const today = todayBerlin();
      const [open, have] = await Promise.all([
        all<{ weekday: number }>(db, "SELECT DISTINCT weekday FROM slots WHERE active = 1 AND location IS NULL"),
        all<{ date: string }>(db, "SELECT date FROM attendance WHERE date >= ?", addDays(today, -14)),
      ]);
      const days = new Set(open.map((r) => r.weekday));
      const done = new Set(have.map((r) => r.date));
      for (let i = 1; i <= 14; i++) {
        const d = addDays(today, -i);
        if (days.has(isoWeekday(d)) && !done.has(d)) return c.json({ date: d }, 200);
      }
      return c.json({ date: null }, 200);
    },
  )
  .openapi(
    createRoute({
      method: "get",
      path: "/attendance/stats",
      request: { query: z.object({ months: z.coerce.number().int().min(2).max(3).default(3) }) },
      responses: { 200: { description: "Statistik", content: json(StatsOut) } },
    }),
    async (c) => {
      const { months } = c.req.valid("query");
      const today = todayBerlin();
      const rows = await all<Row>(c.env.DB, "SELECT date, total, cancelled FROM attendance WHERE date >= ?", statsSince(today, months));
      return c.json(statsFrom(rows, today, months), 200);
    },
  )
  .openapi(
  createRoute({
    method: "put",
    path: "/attendance/{day}",
    request: { params: z.object({ day: DateIn }), body: { content: json(AttendanceIn), required: true } },
    responses: { 200: { description: "Gespeichert", content: json(AttendanceOut) } },
  }),
  async (c) => {
    const { day } = c.req.valid("param");
    const db = c.env.DB;
    const entry = await validateEntry(db, day, c.req.valid("json"));
    await saveDay(db, day, entry, c.var.user.id);
    return c.json(await toAttendanceOut(db, day), 200);
  },
);
