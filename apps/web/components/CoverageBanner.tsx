"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { KIND_LABEL, WEEKDAYS, deDate, hhmm } from "@/lib/format";

type Gap = components["schemas"]["GapOut"];
type Sync = components["schemas"]["SyncOut"];

export const gapLabel = (g: Gap) =>
  `${WEEKDAYS[g.weekday]} ${deDate(g.date)}, ${hhmm(g.start_time)} ${KIND_LABEL[g.kind]}`;

export function CoverageBanner() {
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [sync, setSync] = useState<Sync | null>(null);
  useEffect(() => {
    api.GET("/api/coverage").then(({ data }) => data && setGaps(data)).catch(() => {});
    api.GET("/api/sync-status").then(({ data }) => data && setSync(data)).catch(() => {});
  }, []);
  const open = gaps.filter((g) => g.level === "unbesetzt");
  const partial = gaps.filter((g) => g.level === "teilweise");
  const syncBad = sync?.enabled && !sync.ok;
  if (!open.length && !partial.length && !syncBad) return null;
  return (
    <a href="/urlaub/" className="mb-4 block rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
      {open.length > 0 && (
        <div role="alert" className="mb-2 rounded-xl border border-danger bg-danger/10 p-3 font-semibold text-danger">
          Kein Trainer: {open.slice(0, 3).map((g) => (
            <div key={`${g.slot_id}${g.date}`}>{gapLabel(g)}</div>
          ))}
          {open.length > 3 && <div>… und {open.length - 3} weitere</div>}
        </div>
      )}
      {partial.length > 0 && (
        <p className="text-sm text-neutral-700">{partial.length} Einheit(en) mit fehlendem Trainer, aber noch besetzt.</p>
      )}
      {syncBad && (
        <p role="alert" className="text-sm text-danger">Kalender-Sync fehlgeschlagen seit {deDate(String(sync!.error_since).slice(0, 10))}.</p>
      )}
    </a>
  );
}
