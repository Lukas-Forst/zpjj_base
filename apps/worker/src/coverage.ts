import { addDays, isoWeekday } from "./dates";

export type CovSlot = {
  id: number;
  weekday: number;
  kind: string;
  active: boolean;
  start_time: string;
  trainers: { id: number; active: boolean; is_trainer: boolean }[];
};
export type CovVacation = { user_id: number; start_date: string; end_date: string };
export type CovSubstitute = { slot_id: number; date: string; user_id: number };
export type Status = "nicht_geprueft" | "besetzt" | "teilweise" | "unbesetzt" | "vertreten";
export type Gap = { date: string; slot_id: number; level: "unbesetzt" | "teilweise"; absent_user_ids: number[] };

const CHECKED = new Set(["no_gi", "gi"]);

/** Coverage of `slot` on `day` (caller guarantees the weekday matches). */
export function slotStatus(
  slot: CovSlot,
  day: string,
  off: Set<number>,
  substitutes: CovSubstitute[],
): { status: Status; absent: number[] } {
  if (!CHECKED.has(slot.kind)) return { status: "nicht_geprueft", absent: [] };
  const trainers = slot.trainers.filter((t) => t.active && t.is_trainer).map((t) => t.id);
  const absent = trainers.filter((t) => off.has(t));
  if (!absent.length) return { status: "besetzt", absent: [] };
  if (substitutes.some((x) => x.slot_id === slot.id && x.date === day && !off.has(x.user_id))) return { status: "vertreten", absent };
  return { status: absent.length === trainers.length ? "unbesetzt" : "teilweise", absent };
}

/** Who is on vacation per day of [from, from+days): one pass over the vacations. */
export function offByDay(vacations: CovVacation[], from: string, days: number): Map<string, Set<number>> {
  const last = addDays(from, days - 1);
  const m = new Map<string, Set<number>>();
  for (const v of vacations) {
    for (let d = v.start_date < from ? from : v.start_date; d <= v.end_date && d <= last; d = addDays(d, 1)) {
      const s = m.get(d) ?? new Set<number>();
      s.add(v.user_id);
      m.set(d, s);
    }
  }
  return m;
}

export function computeGaps(slots: CovSlot[], vacations: CovVacation[], substitutes: CovSubstitute[], today: string, days = 28): Gap[] {
  const off = offByDay(vacations, today, days);
  const gaps: Gap[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(today, i);
    const wd = isoWeekday(d);
    const o = off.get(d);
    if (!o) continue; // nobody absent: no gap possible
    for (const s of slots) {
      if (!s.active || s.weekday !== wd) continue;
      const { status, absent } = slotStatus(s, d, o, substitutes);
      if (status === "unbesetzt" || status === "teilweise") gaps.push({ date: d, slot_id: s.id, level: status, absent_user_ids: absent });
    }
  }
  const start = new Map(slots.map((s) => [s.id, s.start_time]));
  return gaps.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : start.get(x.slot_id)! < start.get(y.slot_id)! ? -1 : start.get(x.slot_id)! > start.get(y.slot_id)! ? 1 : 0));
}

/** ISO-8601 week number of a YYYY-MM-DD date. */
export function isoWeek(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // Thursday of this week
  return Math.ceil(((+d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
