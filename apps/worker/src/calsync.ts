/** Two-way vacation sync. Base entries are authoritative; calendar-origin entries follow the
 *  calendar, but only after a *successful* fetch (a failed fetch changes nothing). */
import type { Context } from "hono";
import { addDays, todayBerlin } from "./dates";
import { all, batch, first, stmt } from "./db";
import { type CalendarClient, firstWord, GoogleCalendar, matchUser } from "./gcal";
import type { AppEnv, Bindings } from "./types";

type U = { id: number; display_name: string };
type V = { id: number; user_id: number; start_date: string; end_date: string; source: string; gcal_event_id: string | null; display_name: string };

let cached: { key: string; client: GoogleCalendar } | null = null;
/** Seam for tests: swap `calendar.makeClient`. Null = Google not configured. */
export const calendar = {
  makeClient(env: Bindings): CalendarClient | null {
    const { GCAL_CALENDAR_ID: id, GCAL_SERVICE_ACCOUNT_JSON: json } = env;
    if (!id || !json) return null;
    const key = `${id}\n${json}`;
    if (cached?.key !== key) cached = { key, client: new GoogleCalendar(id, json) };
    return cached.client;
  },
};

// ponytail: no lease, so two overlapping runs (cron + hook) can transiently create a duplicate Google event,
// which the next run deletes; imports are idempotent (ON CONFLICT DO NOTHING). Add a lease column in sync_state if it matters.
export async function syncCalendar(db: D1Database, client: CalendarClient, today: string, nowIso: string): Promise<void> {
  const lo = addDays(today, -30);
  const hi = addDays(today, 365);
  try {
    const events = await client.listEvents(lo, hi);
    const users = await all<U>(db, "SELECT id, display_name FROM users WHERE active = 1");
    const vacs = await all<V>(
      db,
      `SELECT v.id, v.user_id, v.start_date, v.end_date, v.source, v.gcal_event_id, u.display_name
       FROM vacations v JOIN users u ON u.id = v.user_id WHERE v.end_date >= ? AND v.start_date <= ?`,
      lo, hi,
    );
    const w: D1PreparedStatement[] = []; // all DB writes, executed as one batch at the very end
    const byId = new Map(events.map((e) => [e.id, e]));
    const byBase = new Map(events.filter((e) => e.private_base_id).map((e) => [e.private_base_id!, e]));

    const claimed = new Set<string>();
    for (const v of vacs.filter((x) => x.source === "base")) {
      const title = `${cap(firstWord(v.display_name))} Urlaub`;
      let ev = (v.gcal_event_id ? byId.get(v.gcal_event_id) : undefined) ?? byBase.get(String(v.id)); // adopt after a half-failed run
      if (ev && (ev.title !== title || claimed.has(ev.id))) ev = undefined; // hand-edited/foreign: recreate, old one is removed below
      if (!ev) {
        const id = await client.create(title, v.start_date, v.end_date, v.id);
        w.push(stmt(db, "UPDATE vacations SET gcal_event_id = ? WHERE id = ?", id, v.id));
        continue;
      }
      claimed.add(ev.id);
      if (v.gcal_event_id !== ev.id) w.push(stmt(db, "UPDATE vacations SET gcal_event_id = ? WHERE id = ?", ev.id, v.id));
      if (ev.start !== v.start_date || ev.end_inclusive !== v.end_date) await client.update(ev.id, v.start_date, v.end_date);
    }

    for (const ev of events) if (ev.private_base_id && !claimed.has(ev.id)) await client.delete(ev.id);

    const unmatched = new Set<string>();
    const known = new Map(vacs.filter((x) => x.source === "calendar" && x.gcal_event_id).map((x) => [x.gcal_event_id!, x]));
    const dels: D1PreparedStatement[] = [];
    for (const ev of events.filter((e) => !e.private_base_id)) {
      const u = matchUser(ev.title, users);
      if (u === null || u === "ambiguous") {
        unmatched.add(ev.title);
        continue;
      }
      const v = known.get(ev.id);
      if (!v) {
        w.push(stmt(db, "INSERT INTO vacations (user_id, start_date, end_date, source, gcal_event_id, created_at, updated_at) VALUES (?,?,?,'calendar',?,?,?) ON CONFLICT(gcal_event_id) DO NOTHING", u.id, ev.start, ev.end_inclusive, ev.id, nowIso, nowIso));
      } else if (v.user_id !== u.id || v.start_date !== ev.start || v.end_date !== ev.end_inclusive) {
        w.push(stmt(db, "UPDATE vacations SET user_id = ?, start_date = ?, end_date = ?, updated_at = ? WHERE id = ?", u.id, ev.start, ev.end_inclusive, nowIso, v.id));
      }
    }
    for (const [eid, v] of known) if (!byId.has(eid)) dels.push(stmt(db, "DELETE FROM vacations WHERE id = ?", v.id)); // rows whose event still exists stay, even if now unmatched

    await batch(db, [
      ...dels,
      ...w,
      stmt(
        db,
        `INSERT INTO sync_state (id, last_ok_at, error, error_since, unmatched) VALUES (1, ?, NULL, NULL, ?)
         ON CONFLICT(id) DO UPDATE SET last_ok_at = excluded.last_ok_at, error = NULL, error_since = NULL, unmatched = excluded.unmatched`,
        nowIso, JSON.stringify([...unmatched].sort(byCodePoint)),
      ),
    ]);
  } catch (exc) {
    console.error("calendar sync failed", exc);
    const st = await first<{ error_since: string | null }>(db, "SELECT error_since FROM sync_state WHERE id = 1");
    const text = `${exc instanceof Error ? exc.name : "Error"}: ${exc instanceof Error ? exc.message : String(exc)}`.slice(0, 500);
    await batch(db, [
      stmt(
        db,
        `INSERT INTO sync_state (id, error, error_since, unmatched) VALUES (1, ?, ?, '[]')
         ON CONFLICT(id) DO UPDATE SET error = excluded.error, error_since = excluded.error_since`,
        text, st?.error_since ?? nowIso,
      ),
    ]);
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const byCodePoint = (a: string, b: string) => {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
  return x.length - y.length;
};

/** No-op without Google configuration. Never throws. */
export async function runSync(env: Bindings): Promise<void> {
  try {
    const client = calendar.makeClient(env);
    if (client) await syncCalendar(env.DB, client, todayBerlin(), new Date().toISOString());
  } catch (e) {
    console.error("calendar sync run failed", e);
  }
}

export const onVacationChange = (c: Context<AppEnv>): Promise<void> => runSync(c.env);
