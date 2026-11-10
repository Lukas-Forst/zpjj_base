"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { WEEKDAYS, deDate, isoWeekday } from "@/lib/format";

type Missing = components["schemas"]["MissingOut"];

export function MissingNumbers() {
  const [m, setM] = useState<Missing | null>(null);
  useEffect(() => {
    api.GET("/api/attendance/missing").then(({ data }) => data && setM(data)).catch(() => {});
  }, []);
  if (!m?.date) return null;
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
      <p className="text-sm font-medium">Zahlen von {WEEKDAYS[isoWeekday(m.date)]} {deDate(m.date)}. fehlen</p>
      <a href={`/anwesenheit/?datum=${m.date}`} className="rounded-xl bg-neutral-900 px-3 py-2 text-sm font-semibold text-white">Eintragen</a>
    </div>
  );
}
