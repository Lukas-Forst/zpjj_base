import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { Role } from "../schemas/common";
import type { AppEnv } from "../types";

export const MeOut = z
  .object({
    id: z.number().int(),
    display_name: z.string(),
    role: Role,
    is_trainer: z.boolean(),
  })
  .openapi("MeOut");

const route = createRoute({
  method: "get",
  path: "/me",
  responses: { 200: { description: "Aktueller Nutzer", content: { "application/json": { schema: MeOut } } } },
});

export const me = new OpenAPIHono<AppEnv>().openapi(route, (c) => {
  const { id, display_name, role, is_trainer } = c.var.user;
  return c.json({ id, display_name, role, is_trainer }, 200);
});
