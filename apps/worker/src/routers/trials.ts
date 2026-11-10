import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { all, first, run } from "../db";
import { addDays, todayBerlin } from "../dates";
import { HttpError } from "../errors";
import { nameKey } from "../attendance";
import { DateIn } from "../schemas/common";
import type { AppEnv } from "../types";

const TrialOut = z
  .object({
    id: z.number().int(), name: z.string(), status: z.string(), first_date: z.string(), member_since: z.string().nullable(),
    visits: z.number().int(), last_visit: z.string().nullable(), due: z.boolean(), recent: z.boolean(),
  })
  .openapi("TrialOut");
const TrialPatch = z
  .object({ status: z.enum(["offen", "mitglied", "zahlt_pro_besuch"]), member_since: DateIn.nullish() })
  .openapi("TrialPatch");
const json = <S extends z.ZodType>(schema: S) => ({ "application/json": { schema } });

type Row = { id: number; name: string; status: string; first_date: string; member_since: string | null; visits: number; last_visit: string | null };

async function rows(db: D1Database, id?: number): Promise<z.infer<typeof TrialOut>[]> {
  const today = todayBerlin();
  const from = addDays(today, -28);
  const found = await all<Row>(
    db,
    `SELECT t.id, t.name, t.status, t.first_date, t.member_since, COUNT(ta.date) AS visits, MAX(ta.date) AS last_visit
     FROM trials t LEFT JOIN trial_attendance ta ON ta.trial_id = t.id
     WHERE (?1 IS NULL OR t.id = ?1) GROUP BY t.id`,
    id ?? null,
  );
  const out = found.map((t) => ({
    ...t,
    due: t.status === "offen" && t.visits >= 2,
    recent: t.last_visit !== null && t.last_visit >= from && t.last_visit <= today,
  }));
  return out.sort(
    (a, b) =>
      Number(!a.due) - Number(!b.due) ||
      (b.last_visit ?? "").localeCompare(a.last_visit ?? "") ||
      nameKey(a.name).localeCompare(nameKey(b.name)),
  );
}

export const trials = new OpenAPIHono<AppEnv>()
  .openapi(
    createRoute({ method: "get", path: "/trials", responses: { 200: { description: "Personen", content: json(z.array(TrialOut)) } } }),
    async (c) => c.json(await rows(c.env.DB), 200),
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/trials/{id}",
      request: { params: z.object({ id: z.coerce.number().int() }), body: { content: json(TrialPatch), required: true } },
      responses: { 200: { description: "Aktualisiert", content: json(TrialOut) } },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      if (!(await first(c.env.DB, "SELECT id FROM trials WHERE id = ?", id))) throw new HttpError(404, "Person nicht gefunden.");
      const since = body.status === "mitglied" ? (body.member_since || todayBerlin()) : null;
      await run(c.env.DB, "UPDATE trials SET status = ?, member_since = ? WHERE id = ?", body.status, since, id);
      return c.json((await rows(c.env.DB, id))[0], 200);
    },
  );
