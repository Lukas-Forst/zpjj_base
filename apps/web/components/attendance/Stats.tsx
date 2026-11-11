"use client";
import { useEffect, useState } from "react";
import { SectionHeader } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { WeekdayBars } from "./WeekdayBars";
import { WeeklyLine } from "./WeeklyLine";

type StatsOut = components["schemas"]["StatsOut"];

export function Stats() {
  const [months, setMonths] = useState<2 | 3>(3);
  const [stats, setStats] = useState<StatsOut | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    setErr(false); setStats(null);
    api.GET("/api/attendance/stats", { params: { query: { months } } })
      .then(({ data }) => { if (!live) return; if (data) setStats(data); else setErr(true); })
      .catch(() => live && setErr(true));
    return () => { live = false; };
  }, [months]);

  return (
    <div>
      <div className="mb-4 flex gap-2">
        {([2, 3] as const).map((m) => (
          <button key={m} type="button" aria-pressed={m === months} onClick={() => setMonths(m)}
            className={`min-h-11 border px-4 font-semibold ${m === months ? "border-ink bg-ink text-paper" : "border-hairline-strong"}`}>{m} Monate</button>
        ))}
      </div>
      {err && <p role="alert" className="border-l-4 border-warn py-1 pl-3 font-semibold">Auswertung konnte nicht geladen werden.</p>}
      {!stats && !err && <p className="text-sm text-muted-ink">Lädt …</p>}
      {stats && (<>
        <SectionHeader title="Ø Teilnehmer pro Woche" />
        <div className="mb-8 mt-3"><WeeklyLine weeks={stats.weeks} /></div>
        <SectionHeader title="Ø pro Wochentag" />
        <div className="mt-3"><WeekdayBars data={stats.weekday_avg} /></div>
      </>)}
    </div>
  );
}
