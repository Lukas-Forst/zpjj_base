"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell, useCurrentMe } from "@/components/AppShell";
import { CoveragePlan } from "@/components/urlaub/CoveragePlan";
import { Button, EmptyState, FIELD, ListRow, Notice, OutlineButton, PageTitle, SectionHeader } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { deDate, errText } from "@/lib/format";

type Vac = components["schemas"]["VacationOut"];
type Week = components["schemas"]["PlanWeek"];
type Sync = components["schemas"]["SyncOut"];
type User = components["schemas"]["UserOut"];

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
    <main className="mx-auto max-w-4xl px-5 py-6">
      <PageTitle>Urlaub</PageTitle>
      {err && <Notice>{err}</Notice>}
      {sync?.enabled && !sync.ok && <Notice>Kalender-Sync fehlgeschlagen seit {deDate(String(sync.error_since).slice(0, 10))}.</Notice>}

      <section className="mb-6" aria-labelledby="plan">
        <h2 id="plan" className="sr-only">Besetzung der nächsten Wochen</h2>
        <CoveragePlan weeks={weeks} meId={me.id} isTrainer={me.is_trainer} boss={boss} myAbsent={myAbsent}
          onSubstitute={(slotId, date) => act(api.PUT("/api/coverage/substitutes", { body: { slot_id: slotId, date, user_id: null } }))}
          onWithdraw={(slotId, date, userId) => act(api.DELETE("/api/coverage/substitutes", { params: { query: { slot_id: slotId, date, user_id: userId } } }))} />
      </section>

      <section className="mb-6" aria-labelledby="new">
        <div id="new"><SectionHeader title="Urlaub eintragen" /></div>
        <form onSubmit={add} className="mt-3 flex flex-wrap items-end gap-3">
          {boss && (
            <label className="flex flex-col text-sm">Trainer
              <select className={FIELD} value={who} onChange={(e) => setWho(e.target.value ? Number(e.target.value) : "")}>
                <option value="">Ich selbst</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
              </select>
            </label>
          )}
          <label className="flex flex-col text-sm">Von
            <input type="date" required className={FIELD} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col text-sm">Bis
            <input type="date" className={FIELD} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <Button type="submit">Eintragen</Button>
        </form>
      </section>

      <section aria-labelledby="all">
        <SectionHeader title="Übersicht" />
        {vacs.length === 0 ? <EmptyState>Kein Urlaub eingetragen.</EmptyState> : (
          <div>
            {vacs.map((v) => (
              <ListRow key={v.id} aside={mayDelete(v) && <OutlineButton onClick={() => act(api.DELETE("/api/vacations/{vacation_id}", { params: { path: { vacation_id: v.id } } }))}>Löschen</OutlineButton>}>
                <b>{v.user_name}</b>: <span className="font-mono text-sm">{deDate(v.start_date)}–{deDate(v.end_date)}</span>{v.source === "calendar" && <span className="text-sm text-muted-ink"> (aus Kalender)</span>}
              </ListRow>
            ))}
          </div>
        )}
        {sync && sync.unmatched.length > 0 && (
          <div className="mt-4 border-t border-hairline pt-3">
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
