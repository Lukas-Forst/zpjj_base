import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { requireGesellschafter } from "../auth";
import { all, first, run, stmt } from "../db";
import { HttpError } from "../errors";
import { IdParam, NameIn, now, Role } from "../schemas/common";
import type { AppEnv } from "../types";

export const UserOut = z
  .object({
    id: z.number().int(),
    display_name: z.string(),
    role: Role,
    is_trainer: z.boolean(),
    email: z.string(),
    active: z.boolean(),
  })
  .openapi("UserOut");

const emailOk = (v: string) => {
  v = v.trim().toLowerCase();
  return v.includes("@") && !v.startsWith("@") && !v.endsWith("@") && !v.includes(" ");
};
const UserCreate = z
  .object({
    email: z.string().refine(emailOk, "ungültige E-Mail-Adresse"),
    display_name: NameIn,
    role: Role.default("trainer"),
    is_trainer: z.boolean().default(true),
  })
  .openapi("UserCreate");
const UserPatch = z
  .object({
    display_name: NameIn.nullish(),
    role: Role.or(z.null()).optional(),
    is_trainer: z.boolean().nullish(),
    active: z.boolean().nullish(),
  })
  .openapi("UserPatch");

type Row = { id: number; email: string; display_name: string; role: "gesellschafter" | "trainer"; is_trainer: number; active: number };
const COLS = "id, email, display_name, role, is_trainer, active";
const out = (r: Row) => ({ ...r, is_trainer: !!r.is_trainer, active: !!r.active });
const json = <S extends z.ZodType>(schema: S) => ({ "application/json": { schema } });
const guard = { middleware: [requireGesellschafter] };

export const users = new OpenAPIHono<AppEnv>()
  .openapi(
    createRoute({ method: "get", path: "/users", ...guard, responses: { 200: { description: "Nutzer", content: json(z.array(UserOut)) } } }),
    async (c) => c.json((await all<Row>(c.env.DB, `SELECT ${COLS} FROM users ORDER BY display_name, id`)).map(out), 200),
  )
  .openapi(
    createRoute({
      method: "post",
      path: "/users",
      ...guard,
      request: { body: { content: json(UserCreate), required: true } },
      responses: { 201: { description: "Angelegt", content: json(UserOut) } },
    }),
    async (c) => {
      const b = c.req.valid("json");
      const t = now();
      let id: number;
      try {
        id = (
          await run(
            c.env.DB,
            "INSERT INTO users (email, display_name, role, is_trainer, active, created_at, updated_at) VALUES (?,?,?,?,1,?,?)",
            b.email.trim().toLowerCase(), b.display_name.trim(), b.role, b.is_trainer ? 1 : 0, t, t,
          )
        ).meta.last_row_id;
      } catch (e) {
        if (String(e).includes("UNIQUE")) throw new HttpError(409, "E-Mail-Adresse existiert bereits.");
        throw e;
      }
      return c.json(out((await first<Row>(c.env.DB, `SELECT ${COLS} FROM users WHERE id = ?`, id))!), 201);
    },
  )
  .openapi(
    createRoute({
      method: "patch",
      path: "/users/{user_id}",
      ...guard,
      request: { params: z.object({ user_id: IdParam }), body: { content: json(UserPatch), required: true } },
      responses: { 200: { description: "Geändert", content: json(UserOut) } },
    }),
    async (c) => {
      const { user_id } = c.req.valid("param");
      const b = c.req.valid("json");
      const user = await first<Row>(c.env.DB, `SELECT ${COLS} FROM users WHERE id = ?`, user_id);
      if (!user) throw new HttpError(404, "Nutzer nicht gefunden.");
      if (("role" in b && b.role == null) || ("active" in b && b.active == null))
        throw new HttpError(422, "role/active dürfen nicht null sein.");
      if (("is_trainer" in b && b.is_trainer == null) || ("display_name" in b && b.display_name == null))
        throw new HttpError(422, "Felder dürfen nicht null sein.");
      const losesAdmin =
        user.active && user.role === "gesellschafter" && (b.active === false || (b.role != null && b.role !== "gesellschafter"));
      if (losesAdmin) {
        const o = await first<{ n: number }>(
          c.env.DB,
          "SELECT COUNT(*) AS n FROM users WHERE role = 'gesellschafter' AND active = 1 AND id != ?",
          user.id,
        );
        if (!o?.n) throw new HttpError(409, "Der letzte aktive Gesellschafter kann nicht deaktiviert oder herabgestuft werden.");
      }
      const sets: string[] = [];
      const p: unknown[] = [];
      if (b.display_name != null) (sets.push("display_name = ?"), p.push(b.display_name.trim()));
      if (b.role != null) (sets.push("role = ?"), p.push(b.role));
      if (b.is_trainer != null) (sets.push("is_trainer = ?"), p.push(b.is_trainer ? 1 : 0));
      if (b.active != null) (sets.push("active = ?"), p.push(b.active ? 1 : 0));
      sets.push("updated_at = ?");
      p.push(now());
      await stmt(c.env.DB, `UPDATE users SET ${sets.join(", ")} WHERE id = ?`, ...p, user.id).run();
      return c.json(out((await first<Row>(c.env.DB, `SELECT ${COLS} FROM users WHERE id = ?`, user.id))!), 200);
    },
  );
