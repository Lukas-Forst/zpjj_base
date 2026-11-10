import { env, exports } from "cloudflare:workers";

type CallInit = { as?: string; method?: string; json?: unknown; headers?: Record<string, string> };

export function call(path: string, init: CallInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.as) headers["X-Test-User"] = init.as; // honoured only when ENV === "test" (Task 2)
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  return exports.default.fetch(
    new Request(`http://example.com${path}`, {
      method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    }),
  );
}

export async function addUser(o: {
  email: string;
  name?: string;
  role?: "gesellschafter" | "trainer";
  is_trainer?: boolean;
  active?: boolean;
}): Promise<number> {
  const now = new Date().toISOString();
  const r = await env.DB.prepare(
    "INSERT INTO users (email, display_name, role, is_trainer, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  )
    .bind(o.email.toLowerCase(), o.name ?? o.email.split("@")[0], o.role ?? "trainer", o.is_trainer ? 1 : 0, o.active === false ? 0 : 1, now, now)
    .run();
  return r.meta.last_row_id;
}

export async function addSlot(o: {
  weekday: number;
  start_time: string;
  end_time: string;
  kind?: "no_gi" | "gi" | "open_mat";
  active?: boolean;
  sort_order?: number;
  location?: string | null;
  trainers?: number[];
}): Promise<number> {
  const r = await env.DB.prepare(
    "INSERT INTO slots (weekday, start_time, end_time, kind, active, sort_order, location) VALUES (?,?,?,?,?,?,?)",
  )
    .bind(o.weekday, o.start_time, o.end_time, o.kind ?? "no_gi", o.active === false ? 0 : 1, o.sort_order ?? 0, o.location ?? null)
    .run();
  const id = r.meta.last_row_id;
  for (const u of o.trainers ?? []) {
    await env.DB.prepare("INSERT INTO slot_trainers (slot_id, user_id) VALUES (?,?)").bind(id, u).run();
  }
  return id;
}

const TABLES = ["trial_attendance", "trials", "attendance", "substitutes", "vacations", "sync_state", "timer_presets", "slot_trainers", "slots", "users"];

export async function resetDb(): Promise<void> {
  for (const t of TABLES) await env.DB.prepare(`DELETE FROM ${t}`).run();
}
