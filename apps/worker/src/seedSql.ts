import { q } from "./sql";

export type SeedUser = { email: string; display_name: string; role: "gesellschafter" | "trainer"; is_trainer: boolean };
type Row = [day: number, start: string, end: string, kind: "no_gi" | "gi" | "open_mat", trainers: string[], location: string | null];

// Source: https://zpjj.de/schedule (Monday is closed); 1 = Monday. Mirrors the retired Python CLI seed.
const SCHEDULE: Row[] = [
  [2, "18:00:00", "20:00:00", "no_gi", ["Nico", "Can"], null],
  [3, "20:00:00", "22:00:00", "no_gi", ["Chris"], null], // Tim teaches in Rheinheim on Wednesdays
  [4, "18:00:00", "20:00:00", "no_gi", ["Nico", "Lukas"], null],
  [5, "19:00:00", "20:30:00", "no_gi", ["Tim", "Can"], null],
  [5, "20:30:00", "22:00:00", "gi", ["Tim", "Can"], null],
  [6, "16:00:00", "17:30:00", "no_gi", ["Nico", "Chris"], null],
  [6, "17:30:00", "19:00:00", "gi", ["Nico", "Chris"], null],
  [7, "10:00:00", "10:45:00", "no_gi", ["Tim", "Lukas"], null],
  [7, "10:45:00", "11:30:00", "gi", ["Tim", "Lukas"], null],
  [7, "11:30:00", "13:00:00", "open_mat", [], null],
  // Second location: classes there never count for attendance numbers.
  [1, "19:30:00", "21:30:00", "no_gi", ["Nico"], "Rheinheim"],
  [3, "19:30:00", "21:30:00", "no_gi", ["Tim"], "Rheinheim"],
];

export const EXAMPLE_PRESETS: [string, "rounds" | "countdown", Record<string, number>][] = [
  ["Rolling (Beispiel)", "rounds", { rounds: 5, work: 300, rest: 30, prep: 10 }],
  ["Drill (Beispiel)", "rounds", { rounds: 3, work: 180, rest: 20, prep: 10 }],
  ["Tabata (Beispiel)", "rounds", { rounds: 8, work: 20, rest: 10, prep: 10 }],
  ["Wettkampf (Beispiel)", "countdown", { duration: 300 }],
];

/** Idempotent seed SQL. Throws (before any SQL exists) when a trainer has no user. */
export function buildSeedSql(users: SeedUser[], now = new Date().toISOString()): string {
  const have = new Set(users.map((u) => u.display_name.toLowerCase()));
  const missing = [...new Set(SCHEDULE.flatMap((r) => r[4]))].filter((n) => !have.has(n.toLowerCase())).sort();
  if (missing.length) throw new Error(`No user (display_name) for trainer(s): ${missing.join(", ")}`);
  const out: string[] = [];
  for (const u of users) {
    if (u.role !== "gesellschafter" && u.role !== "trainer") throw new Error(`Invalid role for ${u.display_name}: ${u.role}`);
    out.push(
      `INSERT OR IGNORE INTO users (email, display_name, role, is_trainer, active, created_at, updated_at) VALUES (${q(u.email.trim().toLowerCase())}, ${q(u.display_name)}, ${q(u.role)}, ${u.is_trainer ? 1 : 0}, 1, ${q(now)}, ${q(now)});`,
    );
  }
  SCHEDULE.forEach(([day, start, end, kind, names, loc], i) => {
    const key = `weekday = ${day} AND start_time = ${q(start)} AND kind = ${q(kind)}`;
    out.push(`INSERT OR IGNORE INTO slots (weekday, start_time, end_time, kind, active, sort_order, location) VALUES (${day}, ${q(start)}, ${q(end)}, ${q(kind)}, 1, ${i}, ${loc ? q(loc) : "NULL"});`);
    // changes() > 0 only when the slot row was just inserted: existing slots keep their (edited) trainers.
    if (names.length)
      out.push(
        `INSERT OR IGNORE INTO slot_trainers (slot_id, user_id) SELECT s.id, u.id FROM slots s, users u WHERE s.${key.replace(/ AND /g, " AND s.")} AND lower(u.display_name) IN (${names.map((n) => q(n.toLowerCase())).join(", ")}) AND changes() > 0;`,
      );
  });
  EXAMPLE_PRESETS.forEach(([name, mode, config], i) =>
    out.push(
      `INSERT INTO timer_presets (name, mode, config, sort_order, created_at, updated_at) SELECT ${q(name)}, ${q(mode)}, ${q(JSON.stringify(config))}, ${i}, ${q(now)}, ${q(now)} WHERE NOT EXISTS (SELECT 1 FROM timer_presets WHERE name = ${q(name)});`,
    ),
  );
  return out.join("\n") + "\n";
}
