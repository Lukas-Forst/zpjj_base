"use client";
import { useEffect, useState } from "react";
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
    setErr(false);
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
            className={`min-h-11 rounded-lg border px-4 ${m === months ? "border-accent bg-accent text-accent-foreground" : "border-neutral-300"}`}>{m} Monate</button>
        ))}
      </div>
      {err && <p role="alert" className="text-danger">Auswertung konnte nicht geladen werden.</p>}
      {stats && (<>
        <h2 className="mb-2 font-semibold">Ø Teilnehmer pro Woche</h2>
        <div className="mb-6"><WeeklyLine weeks={stats.weeks} /></div>
        <h2 className="mb-2 font-semibold">Ø pro Wochentag</h2>
        <WeekdayBars data={stats.weekday_avg} />
      </>)}
    </div>
  );
}
