"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { todayISO } from "@/lib/attendance";
import { deDate, errText } from "@/lib/format";

type TrialOut = components["schemas"]["TrialOut"];
type Status = components["schemas"]["TrialStatus"];
const btn = "min-h-11 rounded-lg border border-neutral-300 px-4 disabled:opacity-50 dark:border-neutral-600";

export function TrialList({ trials, onUpdate }: { trials: TrialOut[]; onUpdate: (t: TrialOut) => void }) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [err, setErr] = useState("");

  async function set(id: number, status: Status, member_since?: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setErr("");
    try {
      const { data, error } = await api.PATCH("/api/trials/{trial_id}", { params: { path: { trial_id: id } }, body: member_since ? { status, member_since } : { status } });
      if (data) onUpdate(data); else setErr(errText(error, "Speichern fehlgeschlagen."));
    } catch { setErr("Speichern fehlgeschlagen."); }
    finally { lock.current = false; setBusy(false); }
  }

  const shown = trials.filter((t) => t.recent).sort((a, b) => Number(b.due) - Number(a.due));
  if (shown.length === 0) return <p className="text-sm text-neutral-600 dark:text-neutral-400">In den letzten 4 Wochen war niemand im Probetraining.</p>;
  return (
    <div>
      {err && <p role="alert" className="mb-3 text-danger">{err}</p>}
      <ul className="flex flex-col gap-2">
        {shown.map((t) => (
          <li key={t.id} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-700">
            <p className="font-medium">{t.name}</p>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{t.visits} Besuch{t.visits === 1 ? "" : "e"}{t.last_visit && ` · zuletzt ${deDate(t.last_visit)}`}</p>
            {t.status === "mitglied" && (<>
              <p className="my-2 text-sm">Mitglied seit {t.member_since ? deDate(t.member_since) : "–"}</p>
              <label className="flex flex-col text-sm">Mitglied seit
                <input type="date" max={todayISO()} value={t.member_since ?? ""} disabled={busy}
                  onChange={(e) => e.target.value && set(t.id, "mitglied", e.target.value)}
                  className="min-h-11 rounded-lg border border-neutral-300 bg-white px-2 dark:border-neutral-600 dark:bg-neutral-900" />
              </label>
            </>)}
            {t.status === "zahlt_pro_besuch" && <p className="my-2 text-sm">zahlt pro Besuch</p>}
            {t.status === "offen" && t.due && (
              <p className="my-2 text-sm"><b className="text-red-700 dark:text-red-400">Entscheidung fällig</b> · Mitgliedschaft oder pro Besuch zahlen</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {t.status === "offen" ? (<>
                <button type="button" className={btn} disabled={busy} onClick={() => set(t.id, "mitglied")}>Mitglied geworden</button>
                <button type="button" className={btn} disabled={busy} onClick={() => set(t.id, "zahlt_pro_besuch")}>Zahlt pro Besuch</button>
              </>) : (
                <button type="button" className={btn} disabled={busy} onClick={() => set(t.id, "offen")}>Rückgängig</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
