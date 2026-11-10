"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api/client";
import type { components } from "@/lib/api/schema";
import { sundayTotal } from "@/lib/attendance";
import { errText } from "@/lib/format";

type Entry = components["schemas"]["AttendanceOut"];
type TrialOut = components["schemas"]["TrialOut"];

const field = "min-h-11 rounded-lg border border-neutral-300 px-2";
const btn = "min-h-11 rounded-lg border border-accent px-4 text-accent disabled:opacity-50";
const num = (s: string) => (s.trim() === "" ? 0 : Math.max(0, Math.floor(Number(s)) || 0));

function NumField({ label, value, set, required, max }: { label: string; value: string; set: (v: string) => void; required?: boolean; max?: number }) {
  return (
    <label className="flex flex-col text-sm">{label}
      <input type="number" min={0} max={max} inputMode="numeric" required={required} className={field} value={value} onChange={(e) => set(e.target.value)} />
    </label>
  );
}

export function EntryForm({ day, existing, trials, onSaved }: { day: string; existing: Entry | undefined; trials: TrialOut[]; onSaved: () => void }) {
  const sunday = new Date(day + "T00:00").getDay() === 0;
  const [total, setTotal] = useState("");
  const [members, setMembers] = useState("");
  const [nTrials, setNTrials] = useState("0");
  const [guests, setGuests] = useState("0");
  const [mat, setMat] = useState("");
  const [beginner, setBeginner] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  const count = Math.min(30, num(nTrials));
  const edit = (f: (v: string) => void) => (v: string) => { setErr(""); f(v); };
  const nameAt = (i: number) => names[i] ?? "";

  const save = async (cancelled: boolean) => {
    if (busy || saving.current) return;
    if (!cancelled) {
      const used = Array.from({ length: count }, (_, i) => nameAt(i).trim());
      if (sunday ? members.trim() === "" : total.trim() === "") { setErr(sunday ? "Bitte Mitglieder eintragen (auch 0)." : "Bitte Teilnehmer gesamt eintragen (auch 0)."); return; }
      if (used.some((n) => !n)) { setErr("Bitte für jedes Probetraining einen Namen eintragen."); return; }
      if (existing && !confirm("Vorhandenen Eintrag ersetzen?")) return;
    } else if (existing && !confirm("Vorhandenen Eintrag durch 'ausgefallen' ersetzen?")) return;
    saving.current = true; setBusy(true);
    try {
      const body: components["schemas"]["AttendanceIn"] = cancelled ? { cancelled: true, trial_names: [], guests: 0 } : {
        cancelled: false,
        total: sunday ? sundayTotal(num(members), count, num(guests)) : num(total),
        trial_names: Array.from({ length: count }, (_, i) => nameAt(i).trim()),
        guests: num(guests),
        ...(sunday ? { open_mat: mat.trim() === "" ? null : num(mat), beginner: beginner.trim() === "" ? null : num(beginner) } : {}),
      };
      const { error, response } = await api.PUT("/api/attendance/{day}", { params: { path: { day } }, body });
      if (!response.ok) { setErr(errText(error, "Speichern fehlgeschlagen.")); return; }
      onSaved();
    } catch { setErr("Speichern fehlgeschlagen."); } finally { saving.current = false; setBusy(false); }
  };

  const known = trials.filter((t) => t.status === "offen");
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(false); }} className="flex flex-col gap-3">
      {err && <p role="alert" className="text-danger">{err}</p>}
      {sunday
        ? <NumField label="Mitglieder (10:00–11:30)" value={members} set={edit(setMembers)} required />
        : <NumField label="Teilnehmer gesamt" value={total} set={edit(setTotal)} required />}
      <NumField label="Davon Probetraining" value={nTrials} set={edit(setNTrials)} max={30} />
      {Array.from({ length: count }, (_, i) => (
        <label key={i} className="flex flex-col text-sm">Name Probetraining {i + 1}
          <input list="known-trials" required maxLength={100} autoComplete="off" className={field} value={nameAt(i)}
            onChange={(e) => { setErr(""); setNames((p) => { const n = [...p]; n[i] = e.target.value; return n; }); }} />
        </label>
      ))}
      <datalist id="known-trials">
        {known.map((t) => <option key={t.id} value={t.name}>{t.name} ({t.visits} Besuch{t.visits === 1 ? "" : "e"})</option>)}
      </datalist>
      <NumField label={sunday ? "Davon Gäste" : "Davon Gäste (zahlen pro Besuch)"} value={guests} set={edit(setGuests)} />
      {sunday && <>
        <NumField label="Openmat" value={mat} set={edit(setMat)} />
        <NumField label="Anfängerkurs (leer = kein Kurs)" value={beginner} set={edit(setBeginner)} />
      </>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-accent px-4 text-accent-foreground disabled:opacity-50">
          {existing ? "Ersetzen" : "Speichern"}
        </button>
        <button type="button" disabled={busy} className={btn} onClick={() => save(true)}>Ausgefallen</button>
      </div>
    </form>
  );
}
