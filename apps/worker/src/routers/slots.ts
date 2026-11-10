import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { requireGesellschafter } from "../auth";
import { batch, first, run, stmt, all } from "../db";
import { HttpError } from "../errors";
import { IdParam, isUnique, normTime, SlotKind, TimeIn, Weekday } from "../schemas/common";
import { listSlotsWithTrainers, type SlotRow } from "../slots";
import type { AppEnv } from "../types";

const DUP = "Dieser Slot existiert bereits.";
const TrainerOut = z.object({ id: z.number().int(), display_name: z.string() }).openapi("TrainerOut");
export const SlotOut = z
  .object({
    id: z.number().int(),
    weekday: z.number().int(),
    start_time: z.string(),
    end_time: z.string(),
    kind: SlotKind,
    active: z.boolean(),
    sort_order: z.number().int(),
    location: z.string().nullable(),
    trainers: z.array(TrainerOut),
  })
  .openapi("SlotOut");
const SlotCreate = z
  .object({
    weekday: Weekday,
    start_time: TimeIn,
    end_time: TimeIn,
    kind: SlotKind,
    sort_order: z.number().int().default(0),
    location: z.string().nullish(),
  })
  .refine((b) => normTime(b.end_time) > normTime(b.start_time), { message: "Ende muss nach dem Beginn liegen", path: ["end_time"] })
  .openapi("SlotCreate");
const SlotPatch = z
  .object({
    weekday: Weekday.nullish(),
    start_time: TimeIn.nullish(),
    end_time: TimeIn.nullish(),
    kind: SlotKind.or(z.null()).optional(),
    active: z.boolean().nullish(),
    sort_order: z.number().int().nullish(),
    location: z.string().nullish(), // "" = back to the home gym
  })
  .openapi("SlotPatch");
const TrainerIds = z.object({ user_ids: z.array(z.number().int()).max(50, "Zu viele Trainer.") }).openapi("TrainerIds");

const loc = (v: string | null | undefined) => (v ?? "").trim().slice(0, 50) || null;
const out = (s: SlotRow) => ({ ...s, trainers: s.trainers.map(({ id, display_name }) => ({ id, display_name })) });
const json = <S extends z.ZodType>(schema: S) => ({ "application/json": { schema } });
const guard = { middleware: [requireGesellschafter] };
const idParam = z.object({ slot_id: IdParam });

async function getOut(db: D1Database, id: number) {
  const s = (await listSlotsWithTrainers(db, { includeInactive: true, id }))[0];
  if (!s) throw new HttpError(404, "Slot nicht gefunden.");
  return out(s);
}
async function guarded<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (isUnique(e)) throw new HttpError(409, DUP);
    throw e;
  }
}

export const slots = new OpenAPIHono<AppEnv>()
  .openapi(
    createRoute({
      method: "get",
      path: "/slots",
      request: { query: z.object({ include_inactive: z.enum(["true", "false"]).default("false").openapi({ type: "boolean" }) }) },
      responses: { 200: { description: "Slots", content: json(z.array(SlotOut)) } },
    }),
    async (c) => {
      const inc = c.req.valid("query").include_inactive === "true" && c.var.user.role === "gesellschafter";
      return c.json((await listSlotsWithTrainers(c.env.DB, { includeInactive: inc })).map(out), 200);
    },
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/slots",
      ...guard,
      request: { body: { content: json(SlotCreate), required: true } },
      responses: { 201: { description: "Angelegt", content: json(SlotOut) } },
    }),
    async (c) => {
      const b = c.req.valid("json");
      const id = await guarded(async () =>
        (
          await run(
            c.env.DB,
            "INSERT INTO slots (weekday, start_time, end_time, kind, active, sort_order, location) VALUES (?,?,?,?,1,?,?)",
            b.weekday, normTime(b.start_time), normTime(b.end_time), b.kind, b.sort_order, loc(b.location),
          )
        ).meta.last_row_id,
      );
      return c.json(await getOut(c.env.DB, id), 201);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/slots/{slot_id}",
      ...guard,
      request: { params: idParam, body: { content: json(SlotPatch), required: true } },
      responses: { 200: { description: "Geändert", content: json(SlotOut) } },
    }),
    async (c) => {
      const { slot_id } = c.req.valid("param");
      const b = c.req.valid("json");
      const cur = await first<{ start_time: string; end_time: string }>(c.env.DB, "SELECT start_time, end_time FROM slots WHERE id = ?", slot_id);
      if (!cur) throw new HttpError(404, "Slot nicht gefunden.");
      const { location, ...rest } = b;
      if (Object.values(rest).some((v) => v === null)) throw new HttpError(422, "Felder dürfen nicht null sein.");
      const start = b.start_time ? normTime(b.start_time) : cur.start_time;
      const end = b.end_time ? normTime(b.end_time) : cur.end_time;
      if (end <= start) throw new HttpError(422, "Ende muss nach dem Beginn liegen.");
      const sets: string[] = [];
      const p: unknown[] = [];
      const set = (col: string, v: unknown) => (sets.push(`${col} = ?`), p.push(v));
      if (b.weekday != null) set("weekday", b.weekday);
      if (b.start_time != null) set("start_time", start);
      if (b.end_time != null) set("end_time", end);
      if (b.kind != null) set("kind", b.kind);
      if (b.active != null) set("active", b.active ? 1 : 0);
      if (b.sort_order != null) set("sort_order", b.sort_order);
      if ("location" in b) set("location", loc(location));
      if (sets.length) await guarded(() => stmt(c.env.DB, `UPDATE slots SET ${sets.join(", ")} WHERE id = ?`, ...p, slot_id).run());
      return c.json(await getOut(c.env.DB, slot_id), 200);
    },
  )
  .openapi(
    createRoute({
      method: "put",
      path: "/slots/{slot_id}/trainers",
      ...guard,
      request: { params: idParam, body: { content: json(TrainerIds), required: true } },
      responses: { 200: { description: "Trainer gesetzt", content: json(SlotOut) } },
    }),
    async (c) => {
      const { slot_id } = c.req.valid("param");
      await getOut(c.env.DB, slot_id); // 404
      const ids = [...new Set(c.req.valid("json").user_ids)].sort((a, b) => a - b);
      const ok = new Set(
        ids.length
          ? (await all<{ id: number }>(c.env.DB, `SELECT id FROM users WHERE active = 1 AND is_trainer = 1 AND id IN (${ids.map(() => "?").join(",")})`, ...ids)).map((r) => r.id)
          : [],
      );
      const bad = ids.filter((i) => !ok.has(i));
      if (bad.length) throw new HttpError(422, `Keine aktiven Trainer: [${bad.join(", ")}]`);
      await batch(c.env.DB, [
        stmt(c.env.DB, "DELETE FROM slot_trainers WHERE slot_id = ?", slot_id),
        ...ids.map((u) => stmt(c.env.DB, "INSERT INTO slot_trainers (slot_id, user_id) VALUES (?,?)", slot_id, u)),
      ]);
      return c.json(await getOut(c.env.DB, slot_id), 200);
    },
  );
