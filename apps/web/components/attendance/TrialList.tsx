"use client";
import { useRef, useState } from "react";
import { OutlineButton } from "@/components/ui";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { todayISO } from "@/lib/attendance";
import { deDate, errText } from "@/lib/format";

type TrialOut = components["schemas"]["TrialOut"];
type Status = components["schemas"]["TrialStatus"];

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
  if (shown.length === 0) return <p className="text-sm text-muted-ink">In den letzten 4 Wochen war niemand im Probetraining.</p>;
  return (
    <div>
      {err && <p role="alert" className="mb-3 border-l-4 border-warn py-1 pl-3 font-semibold">{err}</p>}
      <ul>
        {shown.map((t) => (
          <li key={t.id} className="border-b border-hairline py-3">
            <p className="font-medium">{t.name}</p>
            <p className="text-sm text-muted-ink">{t.visits} Besuch{t.visits === 1 ? "" : "e"}{t.last_visit && ` · zuletzt ${deDate(t.last_visit)}`}</p>
            {t.status === "mitglied" && (<>
              <p className="my-2 text-sm">Mitglied seit {t.member_since ? deDate(t.member_since) : "–"}</p>
              <label className="flex flex-col text-sm">Mitglied seit
                <input type="date" max={todayISO()} value={t.member_since ?? ""} disabled={busy}
                  onChange={(e) => e.target.value && set(t.id, "mitglied", e.target.value)}
                  className="min-h-11 rounded-sm border border-hairline-strong bg-paper px-2" />
              </label>
            </>)}
            {t.status === "zahlt_pro_besuch" && <p className="my-2 text-sm">zahlt pro Besuch</p>}
            {t.status === "offen" && t.due && (
              <p className="my-2 text-sm"><span aria-hidden className="mr-2 inline-block size-2 bg-warn" /><b>Entscheidung fällig</b> · Mitgliedschaft oder pro Besuch zahlen</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {t.status === "offen" ? (<>
                <OutlineButton disabled={busy} onClick={() => set(t.id, "mitglied")}>Mitglied geworden</OutlineButton>
                <OutlineButton disabled={busy} onClick={() => set(t.id, "zahlt_pro_besuch")}>Zahlt pro Besuch</OutlineButton>
              </>) : (
                <OutlineButton disabled={busy} onClick={() => set(t.id, "offen")}>Rückgängig</OutlineButton>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
