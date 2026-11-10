import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { requireGesellschafter } from "../auth";
import { all, first, run, stmt } from "../db";
import { HttpError } from "../errors";
import { IdParam, NameIn, now, TimerMode } from "../schemas/common";
import type { AppEnv } from "../types";

const MAX_SECONDS = 99 * 60 + 59; // 99:59
const sec = (min: number) => z.number().int().min(min).max(MAX_SECONDS);
export const RoundsConfig = z
  .object({ rounds: z.number().int().min(1).max(99), work: sec(1), rest: sec(0), prep: sec(0).default(10) })
  .strict()
  .openapi("RoundsConfig");
export const CountdownConfig = z.object({ duration: sec(1) }).strict().openapi("CountdownConfig");
export const StopwatchConfig = z.object({}).strict().openapi("StopwatchConfig");
const CONFIG = { rounds: RoundsConfig, countdown: CountdownConfig, stopwatch: StopwatchConfig };
type Mode = z.infer<typeof TimerMode>;

const PresetOut = z
  .object({ id: z.number().int(), name: z.string(), mode: TimerMode, config: z.record(z.string(), z.unknown()), sort_order: z.number().int() })
  .openapi("PresetOut");
const PresetCreate = z
  .object({ name: NameIn, mode: TimerMode, config: z.record(z.string(), z.unknown()), sort_order: z.number().int().default(0) })
  .superRefine((b, ctx) => {
    if (!CONFIG[b.mode].safeParse(b.config).success) ctx.addIssue({ code: "custom", message: "Konfiguration passt nicht zum Modus.", path: ["config"] });
  })
  .openapi("PresetCreate");
const PresetPatch = z
  .object({ name: NameIn.nullish(), mode: TimerMode.or(z.null()).optional(), config: z.record(z.string(), z.unknown()).nullish(), sort_order: z.number().int().nullish() })
  .openapi("PresetPatch");

type Row = { id: number; name: string; mode: Mode; config: string; sort_order: number };
const out = (r: Row) => ({ id: r.id, name: r.name, mode: r.mode, config: JSON.parse(r.config) as Record<string, unknown>, sort_order: r.sort_order });
const COLS = "id, name, mode, config, sort_order";
const json = <S extends z.ZodType>(schema: S) => ({ "application/json": { schema } });
const guard = { middleware: [requireGesellschafter] };
const idParam = z.object({ preset_id: IdParam });
const get = async (db: D1Database, id: number) => {
  const r = await first<Row>(db, `SELECT ${COLS} FROM timer_presets WHERE id = ?`, id);
  if (!r) throw new HttpError(404, "Preset nicht gefunden.");
  return r;
};

export const presets = new OpenAPIHono<AppEnv>()
  .openapi(
    createRoute({ method: "get", path: "/timer-presets", responses: { 200: { description: "Presets", content: json(z.array(PresetOut)) } } }),
    async (c) => c.json((await all<Row>(c.env.DB, `SELECT ${COLS} FROM timer_presets ORDER BY sort_order, id`)).map(out), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/timer-presets",
      ...guard,
      request: { body: { content: json(PresetCreate), required: true } },
      responses: { 201: { description: "Angelegt", content: json(PresetOut) } },
    }),
    async (c) => {
      const b = c.req.valid("json");
      const config = CONFIG[b.mode].parse(b.config); // normalised (defaults filled)
      const t = now();
      const r = await run(
        c.env.DB,
        "INSERT INTO timer_presets (name, mode, config, sort_order, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
        b.name.trim(), b.mode, JSON.stringify(config), b.sort_order, c.var.user.id, t, t,
      );
      return c.json(out(await get(c.env.DB, r.meta.last_row_id)), 201);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/timer-presets/{preset_id}",
      ...guard,
      request: { params: idParam, body: { content: json(PresetPatch), required: true } },
      responses: { 200: { description: "Geändert", content: json(PresetOut) } },
    }),
    async (c) => {
      const { preset_id } = c.req.valid("param");
      const b = c.req.valid("json");
      const cur = await get(c.env.DB, preset_id);
      if (Object.values(b).some((v) => v === null)) throw new HttpError(422, "Felder dürfen nicht null sein.");
      const mode = b.mode ?? cur.mode;
      const parsed = CONFIG[mode].safeParse(b.config ?? JSON.parse(cur.config)); // mode and config must stay consistent
      if (!parsed.success) throw new HttpError(422, "Konfiguration passt nicht zum Modus.");
      await stmt(
        c.env.DB,
        "UPDATE timer_presets SET name = ?, mode = ?, config = ?, sort_order = ?, updated_at = ? WHERE id = ?",
        b.name != null ? b.name.trim() : cur.name, mode, JSON.stringify(parsed.data), b.sort_order ?? cur.sort_order, now(), preset_id,
      ).run();
      return c.json(out(await get(c.env.DB, preset_id)), 200);
    },
  )
  .openapi(
    createRoute({ method: "delete", path: "/timer-presets/{preset_id}", ...guard, request: { params: idParam }, responses: { 204: { description: "Gelöscht" } } }),
    async (c) => {
      const { preset_id } = c.req.valid("param");
      await get(c.env.DB, preset_id);
      await run(c.env.DB, "DELETE FROM timer_presets WHERE id = ?", preset_id);
      return c.body(null, 204);
    },
  );
