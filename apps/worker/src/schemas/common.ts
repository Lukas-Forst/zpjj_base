import { z } from "@hono/zod-openapi";

export const Role = z.enum(["gesellschafter", "trainer"]).openapi("Role");
export const SlotKind = z.enum(["no_gi", "gi", "open_mat"]).openapi("SlotKind");
export const TimerMode = z.enum(["rounds", "countdown", "stopwatch"]).openapi("TimerMode");

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
/** Input time: HH:MM or HH:MM:SS; stored and returned as HH:MM:SS (see normTime). */
export const TimeIn = z.string().regex(TIME_RE, "ungültige Uhrzeit");
export const normTime = (t: string): string => (t.length === 5 ? `${t}:00` : t);

export const NameIn = z
  .string()
  .refine((v) => v.trim().length > 0 && v.trim().length <= 100, "Name erforderlich (max. 100 Zeichen)");
export const Weekday = z.number().int().min(1, "weekday muss 1..7 sein").max(7, "weekday muss 1..7 sein");

export const now = (): string => new Date().toISOString();
export const isUnique = (e: unknown): boolean => String(e).includes("UNIQUE");

/** YYYY-MM-DD that is a real calendar day. */
export const DateIn = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "ungültiges Datum")
  .refine((s) => {
    const t = Date.parse(`${s}T00:00:00Z`); // zod runs refine even after a failed regex: never throw on garbage
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
  }, "ungültiges Datum");

/** Integer path/query id: coerced from the string, documented as a required integer. */
export const IdParam = z.coerce.number().int().openapi({ type: "integer", param: { required: true } });
