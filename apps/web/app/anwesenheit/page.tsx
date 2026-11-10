"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { EntryForm } from "@/components/attendance/EntryForm";
import { Stats } from "@/components/attendance/Stats";
import { Tabs } from "@/components/attendance/Tabs";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { attendanceLine, todayISO } from "@/lib/attendance";
import { WEEKDAYS } from "@/lib/format";

type Entry = components["schemas"]["AttendanceOut"];
type Overview = components["schemas"]["AttendanceOverview"];
type TrialOut = components["schemas"]["TrialOut"];

const TABS = [
  { id: "eintragen", label: "Eintragen" },
  { id: "auswertung", label: "Auswertung" },
  { id: "probetrainings", label: "Probetrainings" },
];
const field = "min-h-11 rounded-lg border border-neutral-300 px-2";
const dash = (n: number | null) => (n === null ? "–" : n);

function Anwesenheit() {
  const today = todayISO();
  const [tab, setTab] = useState("eintragen");
  const [date, setDate] = useState(today);
  const [err, setErr] = useState("");
  const [ov, setOv] = useState<Overview | null>(null);
  const [trials, setTrials] = useState<TrialOut[]>([]);

  const load = useCallback(async () => {
    const { data } = await api.GET("/api/attendance", { params: { query: { days: 400 } } });
    if (data) setOv(data); else setErr("Daten konnten nicht geladen werden.");
    const t = await api.GET("/api/trials");
    if (t.data) setTrials(t.data);
  }, []);
  useEffect(() => { load().catch(() => setErr("Daten konnten nicht geladen werden.")); }, [load]);
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("datum");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= todayISO()) { setDate(d); setTab("eintragen"); }
  }, []);

  const existing = ov?.entries.find((e) => e.date === date);
  const line = (e: Entry) => e.cancelled
    ? `${attendanceLine(e.date, { ...e, total: null, open_mat: null, beginner: null })} · ausgefallen`
    : attendanceLine(e.date, e) + (e.total === null ? " · Gesamt –" : "");

  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="mb-4 text-xl font-semibold">Anwesenheit</h1>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {err && <p role="alert" className="mb-3 text-danger">{err}</p>}

      {tab === "eintragen" && (<>
        <section className="mb-6" aria-labelledby="neu">
          <h2 id="neu" className="mb-2 font-semibold">Eintragen</h2>
          <label className="mb-3 flex flex-col text-sm">Datum
            <input type="date" required max={today} className={field} value={date} onChange={(e) => { setErr(""); setDate(e.target.value); }} />
          </label>
          {existing && <p className="mb-3 text-sm text-neutral-600">Schon eingetragen: {line(existing)}</p>}
          {ov && date
            ? <EntryForm key={date} day={date} existing={existing} trials={trials} onSaved={() => { setErr(""); load().catch(() => setErr("Daten konnten nicht geladen werden.")); }} />
            : <p className="text-sm text-neutral-600">Lädt …</p>}
        </section>

        {ov && (
          <section aria-labelledby="ov">
            <h2 id="ov" className="mb-2 font-semibold">Übersicht</h2>
            <p className="mb-2 text-sm">Ø letzte 14 Tage: <b>{dash(ov.avg_14d)}</b></p>
            <p className="mb-3 text-sm">Ø pro Wochentag: {ov.avg_by_weekday.map((w) => `${WEEKDAYS[w.weekday].slice(0, 2)} ${w.avg ?? "–"}`).join(" · ")}</p>
            {ov.entries.length === 0 ? <p className="text-sm text-neutral-600">Noch nichts eingetragen.</p> : (
              <ul className="flex flex-col gap-2">
                {ov.entries.map((e) => <li key={e.date} className="rounded-xl border border-neutral-200 p-3">{line(e)}</li>)}
              </ul>
            )}
          </section>
        )}
      </>)}
      {tab === "auswertung" && <Stats />}
      {tab === "probetrainings" && <p className="text-sm text-neutral-600">Kommt gleich.</p>}
    </main>
  );
}

export default function Page() {
  return <AppShell><Anwesenheit /></AppShell>;
}
