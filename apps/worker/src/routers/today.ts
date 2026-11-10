import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { isoWeekday, todayBerlin } from "../dates";
import { fetchLists, isoWeek, weekData } from "../trello";
import type { AppEnv } from "../types";

const DayOut = z.object({ weekday: z.number().int(), topics: z.array(z.string()) }).openapi("DayOut");
const TodayOut = z
  .object({
    status: z.string(),
    week: z.number().int(),
    weekday: z.number().int(),
    days: z.array(DayOut),
    next_week: z.string().nullable(),
    month_theme: z.string().nullable().default(null),
  })
  .openapi("TodayOut");

export const today = new OpenAPIHono<AppEnv>().openapi(
  createRoute({
    method: "get",
    path: "/today",
    responses: { 200: { description: "Technikplan der Woche", content: { "application/json": { schema: TodayOut } } } },
  }),
  async (c) => {
    const now = todayBerlin();
    const weekday = isoWeekday(now) - 1; // 0 = Montag
    const { TRELLO_KEY: key, TRELLO_TOKEN: token, TRELLO_BOARD: board } = c.env;
    if (!(key && token && board)) {
      return c.json({ status: "unconfigured", week: isoWeek(now), weekday, days: [], next_week: null, month_theme: null }, 200);
    }
    const data = await weekData(() => fetchLists(key, token, board), now);
    return c.json({ weekday, ...data }, 200);
  },
);
