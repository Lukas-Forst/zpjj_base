import { addDays, isoWeekday } from "./dates";

/** Mean rounded to 1 decimal, half-even on exact ties like Python round(); null for no values. */
export function avg(sum: number, n: number): number | null {
  if (!n) return null;
  const v = sum / n;
  const q = v * 4;
  if (q % 2 !== 0 && Number.isInteger(q)) {
    const lo = Math.floor(v * 10); // exact tie x.25 / x.75
    return (lo % 2 === 0 ? lo : lo + 1) / 10;
  }
  return Number(v.toFixed(1));
}

/** Same day-of-month n months earlier, clamped to the month's last day. */
export function monthsAgo(today: string, n: number): string {
  const [y0, m0, d0] = today.split("-").map(Number);
  const t = y0 * 12 + m0 - 1 - n;
  const y = Math.floor(t / 12);
  const m = (t % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d0, last)).padStart(2, "0")}`;
}

export type Acc = { sum: number; n: number };
const acc = (k: number): Acc[] => Array.from({ length: k }, () => ({ sum: 0, n: 0 }));
const add = (a: Acc, v: number) => {
  a.sum += v;
  a.n++;
};
const weekdayOut = (a: Acc[]) => a.map((x, i) => ({ weekday: i + 1, avg: avg(x.sum, x.n) }));
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

type Row = { date: string; total: number | null; cancelled: number };

/** Single pass over all attendance rows: weekday averages (all time) and the 14-day average. */
export function overviewAverages(rows: Row[], today: string) {
  const wd = acc(7);
  const w14 = { sum: 0, n: 0 };
  const from14 = addDays(today, -13);
  for (const r of rows) {
    if (r.cancelled || r.total === null) continue;
    add(wd[isoWeekday(r.date) - 1], r.total);
    if (r.date >= from14 && r.date <= today) add(w14, r.total);
  }
  return { avg_14d: avg(w14.sum, w14.n), avg_by_weekday: weekdayOut(wd) };
}

const firstWeek = (today: string) => addDays(today, -(isoWeekday(today) - 1) - 77);
/** Earliest date the stats need. */
export const statsSince = (today: string, months: number) => [firstWeek(today), monthsAgo(today, months)].sort()[0];

/** Single pass: 12 Monday-start weeks (oldest first) and weekday averages inside [monthsAgo, today]. */
export function statsFrom(rows: Row[], today: string, months: number) {
  const first = firstWeek(today);
  const start = monthsAgo(today, months);
  const weeks = acc(12);
  const wd = acc(7);
  for (const r of rows) {
    if (r.cancelled || r.total === null) continue;
    const i = Math.floor(dayDiff(r.date, first) / 7);
    if (i >= 0 && i < 12) add(weeks[i], r.total);
    if (r.date >= start && r.date <= today) add(wd[isoWeekday(r.date) - 1], r.total);
  }
  return {
    months,
    weeks: weeks.map((w, i) => ({ week_start: addDays(first, 7 * i), avg: avg(w.sum, w.n), days: w.n })),
    weekday_avg: weekdayOut(wd),
  };
}
