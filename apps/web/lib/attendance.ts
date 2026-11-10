import { WEEKDAYS, deDate } from "@/lib/format";

/** Local calendar day as YYYY-MM-DD (not UTC). ponytail: device clock, server enforces Berlin day. */
export const todayISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Counts = {
  total: number | null; members: number | null; trials: number; guests?: number;
  open_mat: number | null; beginner: number | null; names: string[];
};

/** "Mi 10.11. · 10 gesamt · 9 Mitglieder · 1 Probetraining: David · Openmat 4" */
export function attendanceLine(iso: string, c: Counts): string {
  const wd = WEEKDAYS[new Date(iso + "T00:00").getDay() || 7].slice(0, 2);
  const parts = [`${wd} ${deDate(iso).replace(/\.$/, "")}.`];
  if (c.total !== null) {
    parts.push(`${c.total} gesamt`, `${c.members} Mitglieder`);
    parts.push(`${c.trials} Probetraining${c.trials === 1 ? "" : "s"}${c.names.length ? `: ${c.names.join(", ")}` : ""}`);
    if (c.guests) parts.push(`${c.guests} Gäste`);
  }
  if (c.open_mat !== null) parts.push(`Openmat ${c.open_mat}`);
  if (c.beginner !== null) parts.push(`Anfängerkurs ${c.beginner}`);
  return parts.join(" · ");
}

/** Sunday headcount: members plus trials plus paying guests. */
export const sundayTotal = (members: number, trials: number, guests: number) => members + trials + guests;
