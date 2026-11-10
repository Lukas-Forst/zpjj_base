"use client";
import { useEffect, useState } from "react";
import type { components } from "@/lib/api/schema";
import { KIND_LABEL, WEEKDAYS, deDate, hhmm } from "@/lib/format";

type Week = components["schemas"]["PlanWeek"];
type Day = components["schemas"]["PlanDay"];
type Slot = components["schemas"]["PlanSlot"];

type Props = {
  weeks: Week[];
  meId: number;
  isTrainer: boolean;
  boss: boolean;
  myAbsent: (date: string) => boolean;
  onSubstitute: (slotId: number, date: string) => void;
  onWithdraw: (slotId: number, date: string, userId: number) => void;
  busy?: boolean;
};

const CARD: Record<string, string> = {
  besetzt: "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/40",
  teilweise: "border-amber-300 bg-amber-50 dark:border-amber-600 dark:bg-amber-950/40",
  unbesetzt: "border-2 border-danger bg-danger/10",
  vertreten: "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/40",
  nicht_geprueft: "border-neutral-200 bg-neutral-50 opacity-70 dark:border-neutral-700 dark:bg-neutral-900",
};
const LABEL: Record<string, string> = { teilweise: "Trainer fehlt", unbesetzt: "kein Trainer" };
const muted = "text-neutral-600 dark:text-neutral-400";
const btn = "mt-1 min-h-11 rounded-lg border border-accent px-3 text-accent";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const isProblem = (s: Slot) => s.status === "unbesetzt" || s.status === "teilweise";

/** Date + n days as YYYY-MM-DD (UTC math, no timezone drift). */
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Desktop = days side by side and always open; phone = only problem days open. */
function useDesktop() {
  const [desk, setDesk] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") { setDesk(true); return; }
    const q = window.matchMedia("(min-width: 768px)");
    setDesk(q.matches);
    const on = (e: MediaQueryListEvent) => setDesk(e.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return desk;
}

function weekSummary(w: Week) {
  const parts = [];
  if (w.unbesetzt) parts.push(`${plural(w.unbesetzt, "Einheit", "Einheiten")} ohne Trainer`);
  if (w.teilweise) parts.push(`${plural(w.teilweise, "Einheit", "Einheiten")} mit fehlendem Trainer`);
  return parts.length ? parts.join(" · ") : "alles besetzt";
}

export function CoveragePlan(p: Props) {
  const desktop = useDesktop();
  const dayLabel = (d: Day) => `${WEEKDAYS[d.weekday].slice(0, 2)} ${deDate(d.date)}`;

  const card = (d: Day, s: Slot) => {
    const here = s.trainers.filter((t) => !s.absent.includes(t));
    const mine = s.substitutes.some((x) => x.user_id === p.meId);
    const jump = isProblem(s) && p.isTrainer && !p.myAbsent(d.date) && !mine;
    return (
      <li key={s.slot_id} className={`rounded-xl border p-3 ${CARD[s.status]}`}>
        <div className="font-semibold">{hhmm(s.start_time)} {KIND_LABEL[s.kind]}</div>
        {s.status !== "nicht_geprueft" && <div>{here.join(", ") || "–"}</div>}
        {s.absent.length > 0 && <div className={`text-sm ${muted}`}>Urlaub: {s.absent.join(", ")}</div>}
        {LABEL[s.status] && (
          <div className={`text-sm font-semibold ${s.status === "unbesetzt" ? "text-danger" : "text-amber-700 dark:text-amber-400"}`}>{LABEL[s.status]}</div>
        )}
        {s.substitutes.map((x) => (
          <div key={x.user_id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-blue-700 dark:text-blue-300">
            <span>{x.user_name} springt ein</span>
            {(p.boss || x.user_id === p.meId) && (
              <button disabled={p.busy} className={btn} aria-label={`Austragen: ${x.user_name}, ${dayLabel(d)} ${hhmm(s.start_time)}`}
                onClick={() => p.onWithdraw(s.slot_id, d.date, x.user_id)}>Austragen</button>
            )}
          </div>
        ))}
        {jump && (
          <button disabled={p.busy} className={btn} aria-label={`Ich springe ein: ${dayLabel(d)} ${hhmm(s.start_time)}`}
            onClick={() => p.onSubstitute(s.slot_id, d.date)}>Ich springe ein</button>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      {p.weeks.map((w) => (
        <section key={w.week_start} aria-label={`KW ${w.iso_week}`}>
          <h2 className="font-semibold">KW {w.iso_week} · {deDate(w.week_start)}–{deDate(addDays(w.week_start, 6))}</h2>
          <p className={`mb-2 text-sm font-medium ${w.unbesetzt ? "text-danger" : w.teilweise ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400"}`}>{weekSummary(w)}</p>
          <div className="flex flex-col gap-2 md:grid md:auto-cols-fr md:grid-flow-col md:items-start">
            {w.days.map((d) => {
              const problem = d.slots.some(isProblem);
              return (
                <details key={d.date} open={desktop || problem} className="rounded-xl">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                    {dayLabel(d)}{!desktop && !problem && <span className={`font-normal ${muted}`}> · alles besetzt</span>}
                  </summary>
                  <ul className="flex flex-col gap-2">{d.slots.map((s) => card(d, s))}</ul>
                </details>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
