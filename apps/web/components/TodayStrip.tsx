"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { WEEKDAYS } from "@/lib/format";

type Today = components["schemas"]["TodayOut"];

const MSG = { no_card: "Kein Thema eingetragen", error: "Themen gerade nicht erreichbar" } as const;

export function TodayStrip() {
  const [t, setT] = useState<Today | null>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    api.GET("/api/today").then(({ data }) => data && setT(data)).catch(() => {});
  }, []);
  if (!t || t.status === "unconfigured") return null; // offline or Trello not set up: no strip
  const topics = t.days[t.weekday]?.topics ?? [];
  const text = t.status !== "ok" ? MSG[t.status as keyof typeof MSG] : topics.length ? topics.join(", ") : MSG.no_card;
  return (
    <>
      <button onClick={() => dlg.current?.showModal()}
        className="mb-4 block min-h-14 w-full rounded-2xl border border-neutral-200 bg-white p-3 text-left shadow-sm">
        <span className="text-sm font-semibold">Heute: </span>
        <span className="text-sm">{text}</span>
      </button>
      <dialog ref={dlg} className="m-auto w-[min(92vw,28rem)] rounded-2xl p-5">
        <h2 className="mb-3 text-lg font-semibold">Woche {t.week}</h2>
        {t.days.map((d) => (
          <div key={d.weekday} className={`mb-2 ${d.weekday === t.weekday ? "font-semibold" : ""}`}>
            <div className="text-sm text-neutral-600">{WEEKDAYS[d.weekday + 1]}</div>
            {d.topics.length ? d.topics.map((x, i) => <div key={i}>{x}</div>) : <div className="text-neutral-500">–</div>}
          </div>
        ))}
        {t.next_week && <p className="mt-3 border-t pt-3"><span className="text-sm text-neutral-600">Folgewoche: </span>{t.next_week}</p>}
        <div className="mt-4 flex justify-end">
          <button className="min-h-11 rounded-lg px-4" onClick={() => dlg.current?.close()}>Schließen</button>
        </div>
      </dialog>
    </>
  );
}
