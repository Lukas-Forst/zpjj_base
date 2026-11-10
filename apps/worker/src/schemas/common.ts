import { z } from "@hono/zod-openapi";

export const Role = z.enum(["gesellschafter", "trainer"]);
export const SlotKind = z.enum(["no_gi", "gi", "open_mat"]);
export const TimerMode = z.enum(["rounds", "countdown", "stopwatch"]);

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
  .refine((s) => new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, "ungültiges Datum");
