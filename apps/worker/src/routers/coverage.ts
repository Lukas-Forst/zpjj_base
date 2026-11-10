import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { computeGaps, isoWeek, offByDay, slotStatus, type CovSubstitute, type CovVacation } from "../coverage";
import { addDays, isoWeekday, todayBerlin } from "../dates";
import { all, first, run } from "../db";
import { HttpError } from "../errors";
import { DateIn, IdParam, SlotKind } from "../schemas/common";
import { listSlotsWithTrainers } from "../slots";
import type { AppEnv } from "../types";

const GapOut = z
  .object({ date: z.string(), slot_id: z.number().int(), weekday: z.number().int(), start_time: z.string(), kind: SlotKind, level: z.string(), absent: z.array(z.string()), location: z.string().nullable() })
  .openapi("GapOut");
const PlanSubstitute = z.object({ user_id: z.number().int(), user_name: z.string() }).openapi("PlanSubstitute");
const PlanSlot = z
  .object({ slot_id: z.number().int(), start_time: z.string(), kind: SlotKind, location: z.string().nullable(), status: z.string(), trainers: z.array(z.string()), absent: z.array(z.string()), substitutes: z.array(PlanSubstitute) })
  .openapi("PlanSlot");
const PlanDay = z.object({ date: z.string(), weekday: z.number().int(), slots: z.array(PlanSlot) }).openapi("PlanDay");
const PlanWeek = z
  .object({ week_start: z.string(), iso_week: z.number().int(), unbesetzt: z.number().int(), teilweise: z.number().int(), days: z.array(PlanDay) })
  .openapi("PlanWeek");
const SubstituteOut = z
  .object({ slot_id: z.number().int(), date: z.string(), user_id: z.number().int(), user_name: z.string(), weekday: z.number().int(), start_time: z.string(), kind: SlotKind })
  .openapi("SubstituteOut");
const SubstituteIn = z.object({ slot_id: z.number().int(), date: DateIn, user_id: z.number().int().nullish() }).openapi("SubstituteIn");

const json = <S extends z.ZodType>(schema: S) => ({ "application/json": { schema } });

async function load(db: D1Database, today: string) {
  const [slots, vacs, subs] = await Promise.all([
    listSlotsWithTrainers(db),
    all<CovVacation>(db, "SELECT user_id, start_date, end_date FROM vacations WHERE end_date >= ?", today),
    all<CovSubstitute>(db, "SELECT slot_id, date, user_id FROM substitutes WHERE date >= ?", today),
  ]);
  return { slots, vacs, subs };
}
const userNames = async (db: D1Database) =>
  new Map((await all<{ id: number; display_name: string }>(db, "SELECT id, display_name FROM users")).map((u) => [u.id, u.display_name]));

export const coverage = new OpenAPIHono<AppEnv>()
  .openapi(
    createRoute({ method: "get", path: "/coverage", responses: { 200: { description: "Lücken", content: json(z.array(GapOut)) } } }),
    async (c) => {
      const today = todayBerlin();
      const { slots, vacs, subs } = await load(c.env.DB, today);
      const by = new Map(slots.map((s) => [s.id, s]));
      const names = await userNames(c.env.DB);
      return c.json(
        computeGaps(slots, vacs, subs, today).map((g) => {
          const s = by.get(g.slot_id)!;
          return { date: g.date, slot_id: g.slot_id, weekday: s.weekday, start_time: s.start_time, kind: s.kind, level: g.level, absent: g.absent_user_ids.map((i) => names.get(i)!), location: s.location };
        }),
        200,
      );
    },
  )
  .openapi(
    createRoute({ method: "get", path: "/coverage/plan", responses: { 200: { description: "Dreiwochenplan", content: json(z.array(PlanWeek)) } } }),
    async (c) => {
      const today = todayBerlin();
      const { slots, vacs, subs } = await load(c.env.DB, today);
      slots.sort((a, b) => (a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : a.id - b.id));
      const names = await userNames(c.env.DB);
      const monday = addDays(today, -(isoWeekday(today) - 1));
      const off = offByDay(vacs, today, 21 + 7); // covers the window up to the end of week 3
      const subsByDay = new Map<string, CovSubstitute[]>();
      for (const x of subs) (subsByDay.get(x.date) ?? subsByDay.set(x.date, []).get(x.date)!).push(x);
      const none = new Set<number>();
      const weeks = [];
      for (let w = 0; w < 3; w++) {
        const start = addDays(monday, 7 * w);
        const days = [];
        let open = 0;
        let partial = 0;
        for (let o = 0; o < 7; o++) {
          const d = addDays(start, o);
          if (d < today) continue;
          const wd = o + 1;
          const offD = off.get(d) ?? none;
          const subsD = subsByDay.get(d) ?? [];
          const cards = [];
          for (const s of slots) {
            if (s.weekday !== wd) continue;
            const { status, absent } = slotStatus(s, d, offD, subsD);
            if (status === "unbesetzt") open++;
            else if (status === "teilweise") partial++;
            cards.push({
              slot_id: s.id, start_time: s.start_time, kind: s.kind, location: s.location, status,
              trainers: s.trainers.filter((t) => t.active && t.is_trainer).map((t) => t.display_name),
              absent: absent.map((a) => names.get(a)!),
              substitutes: subsD.filter((x) => x.slot_id === s.id && !offD.has(x.user_id)).map((x) => ({ user_id: x.user_id, user_name: names.get(x.user_id)! })),
            });
          }
          if (cards.length) days.push({ date: d, weekday: wd, slots: cards });
        }
        weeks.push({ week_start: start, iso_week: isoWeek(start), unbesetzt: open, teilweise: partial, days });
      }
      return c.json(weeks, 200);
    },
  )
  .openapi(
    createRoute({ method: "get", path: "/coverage/substitutes", responses: { 200: { description: "Vertretungen", content: json(z.array(SubstituteOut)) } } }),
    async (c) =>
      c.json(
        await all<z.infer<typeof SubstituteOut>>(
          c.env.DB,
          `SELECT sb.slot_id, sb.date, sb.user_id, u.display_name AS user_name, sl.weekday, sl.start_time, sl.kind
           FROM substitutes sb JOIN slots sl ON sl.id = sb.slot_id JOIN users u ON u.id = sb.user_id
           WHERE sb.date >= ? ORDER BY sb.date, sl.start_time`,
          todayBerlin(),
        ),
        200,
      ),
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/coverage/substitutes",
      request: { body: { content: json(SubstituteIn), required: true } },
      responses: { 204: { description: "Eingetragen" } },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const user = c.var.user;
      const targetId = body.user_id || user.id;
      if (targetId !== user.id && user.role !== "gesellschafter") throw new HttpError(403, "Du darfst nur dich selbst als Vertretung eintragen.");
      const today = todayBerlin();
      const { slots, vacs } = await load(c.env.DB, today);
      // the date must be a day on which somebody of this slot is absent
      if (!computeGaps(slots, vacs, [], today).some((g) => g.slot_id === body.slot_id && g.date === body.date))
        throw new HttpError(422, "An diesem Tag ist für diese Einheit keine Vertretung nötig.");
      const target = await first<{ active: number; is_trainer: number }>(c.env.DB, "SELECT active, is_trainer FROM users WHERE id = ?", targetId);
      if (!target || !target.active || !target.is_trainer) throw new HttpError(422, "Nur aktive Trainer können einspringen.");
      if (vacs.some((v) => v.user_id === targetId && v.start_date <= body.date && body.date <= v.end_date)) throw new HttpError(409, "Du hast an diesem Tag Urlaub.");
      await run(c.env.DB, "INSERT OR IGNORE INTO substitutes (slot_id, date, user_id) VALUES (?,?,?)", body.slot_id, body.date, targetId);
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/coverage/substitutes",
      request: { query: z.object({ slot_id: IdParam, date: DateIn, user_id: IdParam }) },
      responses: { 204: { description: "Ausgetragen" } },
    }),
    async (c) => {
      const q = c.req.valid("query");
      if (q.user_id !== c.var.user.id && c.var.user.role !== "gesellschafter") throw new HttpError(403, "Du darfst nur deine eigene Vertretung austragen.");
      await run(c.env.DB, "DELETE FROM substitutes WHERE slot_id = ? AND date = ? AND user_id = ?", q.slot_id, q.date, q.user_id);
      return c.body(null, 204);
    },
  );
