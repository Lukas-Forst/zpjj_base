"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell, useCurrentMe } from "@/components/AppShell";
import { CoveragePlan } from "@/components/urlaub/CoveragePlan";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { deDate, errText } from "@/lib/format";

type Vac = components["schemas"]["VacationOut"];
type Week = components["schemas"]["PlanWeek"];
type Sync = components["schemas"]["SyncOut"];
type User = components["schemas"]["UserOut"];

const btn = "min-h-11 rounded-lg border border-accent px-3 text-accent";

function Urlaub() {
  const me = useCurrentMe();
  const boss = me.role === "gesellschafter";
  const [vacs, setVacs] = useState<Vac[]>([]);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [sync, setSync] = useState<Sync | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [who, setWho] = useState<number | "">("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const [v, p, y] = await Promise.all([
      api.GET("/api/vacations"), api.GET("/api/coverage/plan"), api.GET("/api/sync-status"),
    ]);
    if (!v.data || !p.data) { setErr("Daten konnten nicht geladen werden."); return; }
    setVacs(v.data); setWeeks(p.data); setSync(y.data ?? null);
    if (boss) { const u = await api.GET("/api/users"); if (u.data) setUsers(u.data.filter((x) => x.active && x.is_trainer)); }
  }, [boss]);
  useEffect(() => { load().catch(() => setErr("Daten konnten nicht geladen werden.")); }, [load]);

  const act = async (p: Promise<{ response: Response; error?: unknown }>) => {
    const { response, error } = await p;
    setErr(response.ok ? "" : errText(error, "Aktion fehlgeschlagen."));
    await load();
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    act(api.POST("/api/vacations", { body: { start_date: from, end_date: to || from, user_id: who === "" ? null : who } }));
    setFrom(""); setTo("");
  };
  const mayDelete = (v: Vac) => v.source === "base" && (boss || v.user_id === me.id);
  const myAbsent = (date: string) => vacs.some((v) => v.user_id === me.id && v.start_date <= date && date <= v.end_date);

  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-xl font-semibold">Urlaub</h1>
      {err && <p role="alert" className="mb-3 text-danger">{err}</p>}
      {sync?.enabled && !sync.ok && <p role="alert" className="mb-3 text-danger">Kalender-Sync fehlgeschlagen seit {deDate(String(sync.error_since).slice(0, 10))}.</p>}

      <section className="mb-6" aria-labelledby="plan">
        <h2 id="plan" className="sr-only">Besetzung der nächsten Wochen</h2>
        <CoveragePlan weeks={weeks} meId={me.id} isTrainer={me.is_trainer} boss={boss} myAbsent={myAbsent}
          onSubstitute={(slotId, date) => act(api.PUT("/api/coverage/substitutes", { body: { slot_id: slotId, date, user_id: null } }))}
          onWithdraw={(slotId, date, userId) => act(api.DELETE("/api/coverage/substitutes", { params: { query: { slot_id: slotId, date, user_id: userId } } }))} />
      </section>

      <section className="mb-6" aria-labelledby="new">
        <h2 id="new" className="mb-2 font-semibold">Urlaub eintragen</h2>
        <form onSubmit={add} className="flex flex-wrap items-end gap-3">
          {boss && (
            <label className="flex flex-col text-sm">Trainer
              <select className="min-h-11 rounded-lg border border-neutral-300 px-2" value={who} onChange={(e) => setWho(e.target.value ? Number(e.target.value) : "")}>
                <option value="">Ich selbst</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col text-sm">Von
            <input type="date" required className="min-h-11 rounded-lg border border-neutral-300 px-2" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col text-sm">Bis
            <input type="date" className="min-h-11 rounded-lg border border-neutral-300 px-2" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="submit" className="min-h-11 rounded-lg bg-accent px-4 text-accent-foreground">Eintragen</button>
        </form>
      </section>

      <section aria-labelledby="all">
        <h2 id="all" className="mb-2 font-semibold">Übersicht</h2>
        {vacs.length === 0 ? <p className="text-sm text-neutral-600">Kein Urlaub eingetragen.</p> : (
          <ul className="flex flex-col gap-2">
            {vacs.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 p-3">
                <span><b>{v.user_name}</b>: {deDate(v.start_date)}–{deDate(v.end_date)}{v.source === "calendar" && <span className="text-sm text-neutral-600"> (aus Kalender)</span>}</span>
                {mayDelete(v) && <button className={btn} onClick={() => act(api.DELETE("/api/vacations/{vacation_id}", { params: { path: { vacation_id: v.id } } }))}>Löschen</button>}
              </li>
            ))}
          </ul>
        )}
        {sync && sync.unmatched.length > 0 && (
          <div className="mt-4 rounded-xl border border-neutral-200 p-3">
            <p className="font-semibold">Nicht zugeordnete Kalendereinträge</p>
            <ul className="list-disc pl-5 text-sm">{sync.unmatched.map((t) => <li key={t}>{t}</li>)}</ul>
          </div>
        )}
      </section>
    </main>
  );
}

export default function Page() {
  return <AppShell><Urlaub /></AppShell>;
}
