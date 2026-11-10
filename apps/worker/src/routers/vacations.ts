import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { all, batch, first, stmt } from "../db";
import { addDays, todayBerlin } from "../dates";
import { HttpError } from "../errors";
import { vacationChanged } from "../hooks";
import { DateIn } from "../schemas/common";
import { now } from "../schemas/common";
import type { AppEnv } from "../types";

const VacationIn = z
  .object({ user_id: z.number().int().nullish(), start_date: DateIn, end_date: DateIn })
  .refine((b) => b.end_date >= b.start_date, { message: "Ende liegt vor dem Beginn", path: ["end_date"] })
  .openapi("VacationIn");
const VacationOut = z
  .object({ id: z.number().int(), user_id: z.number().int(), user_name: z.string(), start_date: z.string(), end_date: z.string(), source: z.string() })
  .openapi("VacationOut");

const PAST = "Vergangenen Urlaub kann nur ein Gesellschafter ändern.";
type Row = { id: number; user_id: number; user_name: string; start_date: string; end_date: string; source: string };
const json = <S extends z.ZodType>(schema: S) => ({ "application/json": { schema } });

export const vacations = new OpenAPIHono<AppEnv>()
  .openapi(
    createRoute({ method: "get", path: "/vacations", responses: { 200: { description: "Urlaub", content: json(z.array(VacationOut)) } } }),
    async (c) =>
      c.json(
        await all<Row>(
          c.env.DB,
          `SELECT v.id, v.user_id, u.display_name AS user_name, v.start_date, v.end_date, v.source
           FROM vacations v JOIN users u ON u.id = v.user_id WHERE v.end_date >= ? ORDER BY v.start_date, v.id`,
          addDays(todayBerlin(), -7),
        ),
        200,
      ),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/vacations",
      request: { body: { content: json(VacationIn), required: true } },
      responses: { 201: { description: "Angelegt", content: json(VacationOut) } },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const user = c.var.user;
      const boss = user.role === "gesellschafter";
      const targetId = body.user_id || user.id;
      if (targetId !== user.id && !boss) throw new HttpError(403, "Du darfst nur deinen eigenen Urlaub eintragen.");
      if (body.end_date < todayBerlin() && !boss) throw new HttpError(403, PAST);
      const target = await first<{ display_name: string; is_trainer: number; active: number }>(
        c.env.DB, "SELECT display_name, is_trainer, active FROM users WHERE id = ?", targetId);
      if (!target || !target.is_trainer || !target.active) throw new HttpError(422, "Nur aktive Trainer können Urlaub eintragen.");
      let start = body.start_date;
      let end = body.end_date;
      const near = await all<{ id: number; start_date: string; end_date: string }>(
        c.env.DB,
        "SELECT id, start_date, end_date FROM vacations WHERE user_id = ? AND source = 'base' AND start_date <= ? AND end_date >= ? ORDER BY id",
        targetId, addDays(end, 1), addDays(start, -1),
      );
      for (const v of near) {
        if (v.start_date < start) start = v.start_date;
        if (v.end_date > end) end = v.end_date;
      }
      const t = now();
      let id: number;
      if (near.length) {
        id = near[0].id;
        await batch(c.env.DB, [
          ...near.slice(1).map((v) => stmt(c.env.DB, "DELETE FROM vacations WHERE id = ?", v.id)),
          stmt(c.env.DB, "UPDATE vacations SET start_date = ?, end_date = ?, updated_at = ? WHERE id = ?", start, end, t, id),
        ]);
      } else {
        const [r] = await batch(c.env.DB, [
          stmt(c.env.DB, "INSERT INTO vacations (user_id, start_date, end_date, source, created_at, updated_at) VALUES (?,?,?,'base',?,?)", targetId, start, end, t, t),
        ]);
        id = r.meta.last_row_id;
      }
      vacationChanged(c);
      return c.json({ id, user_id: targetId, user_name: target.display_name, start_date: start, end_date: end, source: "base" }, 201);
    },
  )
  .openapi(
    createRoute({
      method: "delete",
      path: "/vacations/{vacation_id}",
      request: { params: z.object({ vacation_id: z.coerce.number().int() }) },
      responses: { 204: { description: "Gelöscht" } },
    }),
    async (c) => {
      const { vacation_id } = c.req.valid("param");
      const v = await first<{ user_id: number; end_date: string; source: string }>(
        c.env.DB, "SELECT user_id, end_date, source FROM vacations WHERE id = ?", vacation_id);
      if (!v) throw new HttpError(404, "Nicht gefunden.");
      const user = c.var.user;
      const boss = user.role === "gesellschafter";
      if (v.user_id !== user.id && !boss) throw new HttpError(403, "Du darfst nur deinen eigenen Urlaub löschen.");
      if (v.end_date < todayBerlin() && !boss) throw new HttpError(403, PAST);
      if (v.source === "calendar") throw new HttpError(409, "Dieser Eintrag kommt aus dem Kalender. Bitte dort löschen.");
      await batch(c.env.DB, [stmt(c.env.DB, "DELETE FROM vacations WHERE id = ?", vacation_id)]);
      vacationChanged(c);
      return c.body(null, 204);
    },
  );
