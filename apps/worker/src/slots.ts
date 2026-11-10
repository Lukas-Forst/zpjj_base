import { all } from "./db";

export type SlotRow = {
  id: number;
  weekday: number;
  start_time: string;
  end_time: string;
  kind: "no_gi" | "gi" | "open_mat";
  active: boolean;
  sort_order: number;
  location: string | null;
  trainers: { id: number; display_name: string; active: boolean; is_trainer: boolean }[];
};

type Raw = Omit<SlotRow, "active" | "trainers"> & { active: number };
type RawTrainer = { slot_id: number; id: number; display_name: string; active: number; is_trainer: number };

/** Slots ordered by weekday, start_time, sort_order, id; trainers ordered by id. `id` is for the slots router. */
export async function listSlotsWithTrainers(
  db: D1Database,
  opts: { includeInactive?: boolean; id?: number } = {},
): Promise<SlotRow[]> {
  const where: string[] = [];
  const p: unknown[] = [];
  if (!opts.includeInactive) where.push("active = 1");
  if (opts.id !== undefined) (where.push("id = ?"), p.push(opts.id));
  const slots = await all<Raw>(
    db,
    `SELECT id, weekday, start_time, end_time, kind, active, sort_order, location FROM slots
     ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY weekday, start_time, sort_order, id`,
    ...p,
  );
  if (!slots.length) return [];
  const tr = await all<RawTrainer>(
    db,
    `SELECT st.slot_id, u.id, u.display_name, u.active, u.is_trainer FROM slot_trainers st
     JOIN users u ON u.id = st.user_id ORDER BY u.id`,
  );
  const by = new Map<number, SlotRow["trainers"]>();
  for (const t of tr) {
    const l = by.get(t.slot_id) ?? [];
    l.push({ id: t.id, display_name: t.display_name, active: !!t.active, is_trainer: !!t.is_trainer });
    by.set(t.slot_id, l);
  }
  return slots.map((s) => ({ ...s, active: !!s.active, trainers: by.get(s.id) ?? [] }));
}
