import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { calendar } from "../calsync";
import { first } from "../db";
import type { AppEnv } from "../types";

const SyncOut = z
  .object({
    enabled: z.boolean(),
    ok: z.boolean(),
    error_since: z.string().nullable(),
    last_ok_at: z.string().nullable(),
    unmatched: z.array(z.string()),
  })
  .openapi("SyncOut");

export const syncStatus = new OpenAPIHono<AppEnv>().openapi(
  createRoute({
    method: "get",
    path: "/sync-status",
    responses: { 200: { description: "Kalender-Sync", content: { "application/json": { schema: SyncOut } } } },
  }),
  async (c) => {
    const st = await first<{ last_ok_at: string | null; error_since: string | null; error: string | null; unmatched: string }>(
      c.env.DB, "SELECT last_ok_at, error_since, error, unmatched FROM sync_state WHERE id = 1");
    return c.json(
      {
        enabled: calendar.makeClient(c.env) !== null,
        ok: !st || st.error === null,
        error_since: st?.error_since ?? null,
        last_ok_at: st?.last_ok_at ?? null,
        unmatched: st ? (JSON.parse(st.unmatched) as string[]) : [],
      },
      200,
    );
  },
);
