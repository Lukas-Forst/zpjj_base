"use client";
import { useEffect, useState } from "react";
import { OutlineButton } from "@/components/ui";
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

// Status by line weight, not color: uncovered = thick ink bar, partial = amber dot + text, unchecked = faded.
const CARD: Record<string, string> = {
  besetzt: "border-l border-hairline",
  teilweise: "border-l border-hairline",
  unbesetzt: "border-l-4 border-ink",
  vertreten: "border-l border-hairline",
  nicht_geprueft: "border-l border-hairline opacity-70",
};
const LABEL: Record<string, string> = { teilweise: "Trainer fehlt", unbesetzt: "kein Trainer" };
const muted = "text-muted-ink";

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
      <li key={s.slot_id} className={`border-b border-hairline py-2 pl-3 ${CARD[s.status]}`}>
        <div className="font-semibold">{hhmm(s.start_time)} {KIND_LABEL[s.kind]}
          {s.location && <span className="ml-2 border border-hairline-strong px-2 text-xs font-normal">{s.location}</span>}
        </div>
        {s.status !== "nicht_geprueft" && <div>{here.join(", ") || "–"}</div>}
        {s.absent.length > 0 && <div className={`text-sm ${muted}`}>Urlaub: {s.absent.join(", ")}</div>}
        {LABEL[s.status] && (
          <div className="text-sm font-semibold">
            {s.status === "teilweise" && <span aria-hidden className="mr-2 inline-block size-2 bg-warn" />}{LABEL[s.status]}
          </div>
        )}
        {s.substitutes.map((x) => (
          <div key={x.user_id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{x.user_name} springt ein</span>
            {(p.boss || x.user_id === p.meId) && (
              <OutlineButton disabled={p.busy} aria-label={`Austragen: ${x.user_name}, ${dayLabel(d)} ${hhmm(s.start_time)}`}
                onClick={() => p.onWithdraw(s.slot_id, d.date, x.user_id)}>Austragen</OutlineButton>
            )}
          </div>
        ))}
        {jump && (
          <OutlineButton disabled={p.busy} aria-label={`Ich springe ein: ${dayLabel(d)} ${hhmm(s.start_time)}`}
            onClick={() => p.onSubstitute(s.slot_id, d.date)}>Ich springe ein</OutlineButton>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-8">
      {p.weeks.map((w) => (
        <section key={w.week_start} aria-label={`KW ${w.iso_week}`}>
          <h2 className="border-b-2 border-ink pb-2 text-lg font-bold">KW {w.iso_week} · {deDate(w.week_start)}–{deDate(addDays(w.week_start, 6))}</h2>
          <p className={`mb-2 mt-2 text-sm ${w.unbesetzt ? "font-bold" : "font-medium"}`}>{weekSummary(w)}</p>
          <div className="flex flex-col gap-2 md:grid md:gap-3 md:auto-cols-fr md:grid-flow-col md:items-start">
            {w.days.map((d) => {
              const problem = d.slots.some(isProblem);
              return (
                <details key={d.date} open={desktop || problem}>
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                    {dayLabel(d)}{!desktop && !problem && <span className={`font-normal ${muted}`}> · alles besetzt</span>}
                  </summary>
                  <ul>{d.slots.map((s) => card(d, s))}</ul>
                </details>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
