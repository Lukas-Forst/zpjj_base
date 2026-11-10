import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
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

export const attendance = new OpenAPIHono<AppEnv>().openapi(
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
