import { all, batch, first, stmt } from "./db";
import { HttpError } from "./errors";
import { isoWeekday, todayBerlin } from "./dates";
import { now } from "./schemas/common";
import { cleanName, nameKey } from "./nameKey";

export type DayEntry = { total: number; trial_names: string[]; guests: number; open_mat: number | null; beginner: number | null };
export type AttendanceInBody = { cancelled: boolean; total?: number | null; trial_names: string[]; guests: number; open_mat?: number | null; beginner?: number | null };
export type AttendanceOutBody = {
  date: string; cancelled: boolean; total: number | null; trials: number; guests: number; members: number | null;
  open_mat: number | null; beginner: number | null; names: string[]; updated_by_name: string | null; updated_at: string;
};

const MAX_COUNT = 1000;
const bad = (m: string) => new HttpError(422, m);

export { nameKey };

export async function checkDay(db: D1Database, day: string): Promise<void> {
  if (day > todayBerlin()) throw bad("Für die Zukunft kann nichts eingetragen werden.");
  const open = await first(db, "SELECT id FROM slots WHERE weekday = ? AND active = 1 AND location IS NULL LIMIT 1", isoWeekday(day));
  if (!open) throw bad("An diesem Tag ist kein Training.");
}

export async function validateEntry(db: D1Database, day: string, body: AttendanceInBody): Promise<DayEntry | null> {
  await checkDay(db, day);
  if (body.cancelled) return null;
  if (body.total == null) throw bad("Gesamtzahl fehlt.");
  const total = body.total;
  const open_mat = body.open_mat ?? null;
  const beginner = body.beginner ?? null;
  const names = body.trial_names.map(cleanName);
  if (!names.every(Boolean)) throw bad("Namen dürfen nicht leer sein.");
  if (new Set(names.map(nameKey)).size !== names.length) throw bad("Jeder Name darf nur einmal vorkommen.");
  if (names.length > 30 || names.some((n) => [...n].length > 100)) throw bad("Zu viele oder zu lange Namen.");
  for (const v of [total, open_mat, beginner]) {
    if (v !== null && !(v >= 0 && v <= MAX_COUNT)) throw bad(`Zahlen müssen zwischen 0 und ${MAX_COUNT} liegen.`);
  }
  if (body.guests < 0) throw bad("Gäste können nicht negativ sein.");
  if (names.length + body.guests > total) throw bad("Probetrainings und Gäste sind mehr als die Gesamtzahl.");
  if (isoWeekday(day) !== 7 && (open_mat !== null || beginner !== null)) throw bad("Openmat und Anfängerkurs gibt es nur sonntags.");
  const wording: Record<string, string> = { mitglied: "Mitglied", zahlt_pro_besuch: "zahlt pro Besuch" };
  for (const n of names) {
    const t = await first<{ id: number; status: string; member_since: string | null }>(
      db, "SELECT id, status, member_since FROM trials WHERE name_key = ?", nameKey(n));
    if (!t || !wording[t.status]) continue;
    const linked = await first(db, "SELECT 1 FROM trial_attendance WHERE trial_id = ? AND date = ?", t.id, day);
    if (linked || (t.member_since && day < t.member_since)) continue;
    throw bad(`${n} ist als ${wording[t.status]} markiert und zählt nicht als Probetraining.`);
  }
  return { total, trial_names: names, guests: body.guests, open_mat, beginner };
}

/**
 * Replace one day (entry=null: cancelled). Validation is done by the caller; the only read is the set of
 * old links, then everything is written in ONE atomic batch. Orphan cleanup runs as conditional SQL inside
 * the batch, so it sees the new links: only 'offen' persons whose first_date is this day are touched.
 */
export async function saveDay(db: D1Database, day: string, entry: DayEntry | null, userId: number): Promise<void> {
  const old = await all<{ trial_id: number }>(db, "SELECT trial_id FROM trial_attendance WHERE date = ?", day);
  const s = (sql: string, ...p: unknown[]) => stmt(db, sql, ...p);
  const names = entry ? [...new Map(entry.trial_names.map((n) => [nameKey(n), n])).values()] : [];
  const stmts = [
    s(
      `INSERT INTO attendance (date, cancelled, total, trials, guests, open_mat, beginner, updated_by, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(date) DO UPDATE SET cancelled=excluded.cancelled, total=excluded.total, trials=excluded.trials,
         guests=excluded.guests, open_mat=excluded.open_mat, beginner=excluded.beginner,
         updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
      day, entry ? 0 : 1, entry?.total ?? null, entry ? entry.trial_names.length : 0, entry?.guests ?? 0,
      entry?.open_mat ?? null, entry?.beginner ?? null, userId, now(),
    ),
    s("DELETE FROM trial_attendance WHERE date = ?", day),
    ...names.flatMap((n) => [
      // never move an imported first_date later
      s(
        `INSERT INTO trials (name, name_key, first_date) VALUES (?,?,?)
         ON CONFLICT(name_key) DO UPDATE SET first_date = MIN(first_date, excluded.first_date)`,
        n, nameKey(n), day,
      ),
      s("INSERT INTO trial_attendance (trial_id, date) SELECT id, ? FROM trials WHERE name_key = ?", day, nameKey(n)),
    ]),
    ...old.flatMap(({ trial_id: id }) => [
      s(
        `DELETE FROM trials WHERE id = ? AND status = 'offen' AND first_date = ?
         AND NOT EXISTS (SELECT 1 FROM trial_attendance WHERE trial_id = ?)`,
        id, day, id,
      ),
      s(
        `UPDATE trials SET first_date = (SELECT MIN(date) FROM trial_attendance WHERE trial_id = ?)
         WHERE id = ? AND status = 'offen' AND first_date = ? AND EXISTS (SELECT 1 FROM trial_attendance WHERE trial_id = ?)`,
        id, id, day, id,
      ),
    ]),
  ];
  await batch(db, stmts);
}

export async function toAttendanceOut(db: D1Database, day: string): Promise<AttendanceOutBody> {
  const a = (await first<Record<string, any>>(
    db,
    `SELECT a.*, u.display_name AS updated_by_name FROM attendance a LEFT JOIN users u ON u.id = a.updated_by WHERE a.date = ?`,
    day,
  ))!;
  const names = (
    await all<{ name: string }>(
      db, "SELECT t.name FROM trials t JOIN trial_attendance ta ON ta.trial_id = t.id WHERE ta.date = ? ORDER BY t.name", day)
  ).map((r) => r.name);
  return {
    date: a.date, cancelled: !!a.cancelled, total: a.total, trials: a.trials, guests: a.guests,
    members: a.total === null ? null : a.total - a.trials - a.guests,
    open_mat: a.open_mat, beginner: a.beginner, names, updated_by_name: a.updated_by_name, updated_at: a.updated_at,
  };
}
