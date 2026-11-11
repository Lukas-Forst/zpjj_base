"use client";
import { useEffect, useRef, useState } from "react";
import { EmptyState, ListRow, SectionHeader, SlotTag, type SlotKind } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { WEEKDAYS, deDate, hhmm } from "@/lib/format";

type Slot = components["schemas"]["SlotOut"];
type Today = components["schemas"]["TodayOut"];

const TAG: Record<string, SlotKind> = { no_gi: "nogi", gi: "gi", open_mat: "openmat" };
const where = (s: Slot) => s.location && <span className="text-xs text-muted-ink">{s.location}</span>;
const trainers = (s: Slot) => s.trainers.map((t) => t.display_name).join(", ") || "kein Trainer";

/** Trello week plan (status ok only; unconfigured or unreachable = no theme line). */
export function useTodayTheme() {
  const [t, setT] = useState<Today | null>(null);
  useEffect(() => { api.GET("/api/today").then(({ data }) => data && setT(data)).catch(() => {}); }, []);
  if (!t || t.status !== "ok") return null;
  const topics = t.days[t.weekday]?.topics ?? [];
  return { week: t, text: topics.length ? topics.join(", ") : "Kein Thema eingetragen" };
}

function Theme() {
  const theme = useTodayTheme();
  const dlg = useRef<HTMLDialogElement>(null);
  if (!theme) return null;
  const t = theme.week;
  return (
    <>
      <button onClick={() => dlg.current?.showModal()} className="mt-2 block min-h-11 w-full text-left">
        <span className="block text-base font-semibold leading-snug">{theme.text}</span>
        <span className="text-xs text-muted-ink">Thema aus Trello</span>
      </button>
      <dialog ref={dlg} className="m-auto w-[min(92vw,28rem)] bg-paper p-5 text-ink">
        {t.month_theme && (
          <div className="mb-4 border-b border-hairline pb-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-muted-ink">Monatsthema</div>
            <div className="whitespace-pre-line">{t.month_theme}</div>
          </div>
        )}
        <h2 className="mb-3 text-lg font-bold">Woche {t.week}</h2>
        {t.days.map((d) => (
          <div key={d.weekday} className={`mb-2 ${d.weekday === t.weekday ? "font-semibold" : ""}`}>
            <div className="text-sm text-muted-ink">{WEEKDAYS[d.weekday + 1]}</div>
            {d.topics.length ? d.topics.map((x, i) => <div key={i}>{x}</div>) : <div className="text-muted-ink">–</div>}
          </div>
        ))}
        {t.next_week && <p className="mt-3 border-t border-hairline pt-3"><span className="text-sm text-muted-ink">Folgewoche: </span>{t.next_week}</p>}
        <div className="mt-4 flex justify-end">
          <button className="min-h-11 px-4 font-semibold text-action" onClick={() => dlg.current?.close()}>Schließen</button>
        </div>
      </dialog>
    </>
  );
}

export function Today() {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  useEffect(() => { api.GET("/api/slots").then(({ data }) => data && setSlots(data)).catch(() => {}); }, []);
  const now = new Date();
  const wd = now.getDay() || 7;
  const items = (slots ?? []).filter((s) => s.weekday === wd).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const [first, ...rest] = items;
  return (
    <section aria-label="Heute">
      <SectionHeader title="Heute" aside={`${WEEKDAYS[wd].slice(0, 2).toUpperCase()} ${deDate(now.toLocaleDateString("sv-SE"))}`} />
      {slots && !first && <EmptyState>Heute kein Training.</EmptyState>}
      {first && (
        <div className="border-b border-hairline py-4">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[15px] font-semibold">{hhmm(first.start_time)}</span>
            <SlotTag kind={TAG[first.kind]} />
            {where(first)}
          </div>
          <div className="mt-1 text-sm text-muted-ink">{trainers(first)}</div>
          <Theme />
        </div>
      )}
      {rest.map((s) => (
        <ListRow key={s.id} aside={trainers(s)}>
          <span className="font-mono text-sm font-semibold">{hhmm(s.start_time)}</span> · <SlotTag kind={TAG[s.kind]} /> {where(s)}
        </ListRow>
      ))}
    </section>
  );
}
