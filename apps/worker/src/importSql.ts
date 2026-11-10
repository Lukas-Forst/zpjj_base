import { cleanName, nameKey } from "./nameKey";
import { q } from "./sql";

type Cell = Date | number | string | null | undefined;
/** Raw sheet rows (header included) with cached cell values; parsed by scripts/import-excel.ts. */
export type ImportInput = { training: Cell[][]; probe: Cell[][] };
export type ImportResult = { sql: string; days: number; skipped: number; trials: number; members: number };

const day = (v: Cell): string | null => (v instanceof Date && !isNaN(+v) ? v.toISOString().slice(0, 10) : null);
const str = (v: Cell): string => (v == null ? "" : String(v));

/**
 * One-off history import, same mapping as apps/api/app/import_excel.py. Idempotent SQL: existing days stay
 * untouched and only days inserted by this very run get person links (changes() guard).
 */
export function buildImportSql(input: ImportInput, now = new Date().toISOString()): ImportResult {
  const out: string[] = [];
  const dayStmts: string[] = [];
  let days = 0;
  let skipped = 0;
  const newDays = new Set<string>();
  const seen = new Map<string, { name: string; first: string }>();
  const links = new Map<string, Set<string>>(); // date -> name keys
  const members = new Map<string, string | null>();

  const see = (raw: string, d: string) => {
    const name = cleanName(raw);
    if (!name) return;
    const k = nameKey(name);
    const s = seen.get(k);
    seen.set(k, s ? { name: s.name, first: d < s.first ? d : s.first } : { name, first: d });
    if (!links.has(d)) links.set(d, new Set());
    links.get(d)!.add(k);
  };

  for (const r of input.training.slice(1)) {
    const d = day(r[0]);
    if (d === null) continue; // blank padding row
    const g = r[6];
    if (typeof g !== "number" || isNaN(g)) {
      skipped++;
      continue;
    }
    const total = Math.trunc(g);
    if (!newDays.has(d)) {
      const openMat = str(r[4]).trim().toLowerCase() === "open mat";
      const h = Math.trunc(Number(r[7] ?? 0)) || 0;
      const [t, tr, om] = openMat ? ["NULL", 0, total] : [total, Math.min(h, total), "NULL"];
      dayStmts.push(`INSERT OR IGNORE INTO attendance (date, cancelled, total, trials, guests, open_mat, updated_at) VALUES (${q(d)}, 0, ${t}, ${tr}, 0, ${om}, ${q(now)});`);
      newDays.add(d);
      days++;
    }
    for (const n of str(r[10]).split(",")) see(n, d);
  }
  for (const r of input.probe.slice(1)) {
    for (const v of [r[1], r[2]]) if (r[0] && day(v)) see(str(r[0]), day(v)!);
    const name = cleanName(str(r[0]));
    if (name && (str(r[7]).trim().toLowerCase() === "mitglied geworden" || str(r[3]).trim().toLowerCase() === "ja")) members.set(nameKey(name), day(r[4]));
  }

  let nTrials = 0;
  let nMembers = 0;
  for (const [k, { name, first }] of seen) {
    nTrials++;
    out.push(`INSERT OR IGNORE INTO trials (name, name_key, first_date) VALUES (${q(name)}, ${q(k)}, ${q(first)});`);
    out.push(`UPDATE trials SET first_date = ${q(first)} WHERE name_key = ${q(k)} AND first_date > ${q(first)};`);
    if (members.has(k)) {
      nMembers++;
      const since = members.get(k);
      out.push(`UPDATE trials SET status = 'mitglied', member_since = ${since ? q(since) : "first_date"} WHERE name_key = ${q(k)} AND status = 'offen';`);
    }
  }
  // Day by day: insert the day, then link its persons only if that insert really happened.
  for (const stmt of dayStmts) {
    out.push(stmt);
    const d = /VALUES \('(\d{4}-\d\d-\d\d)'/.exec(stmt)![1];
    const ks = [...(links.get(d) ?? [])];
    if (ks.length)
      out.push(`INSERT OR IGNORE INTO trial_attendance (trial_id, date) SELECT id, ${q(d)} FROM trials WHERE name_key IN (${ks.map(q).join(", ")}) AND changes() > 0;`);
  }
  return { sql: out.join("\n") + "\n", days, skipped, trials: nTrials, members: nMembers };
}
