"use client";
import { useState } from "react";
import { api } from "@/lib/api/client";
import { errText } from "@/lib/format";
import type { Beeper } from "@/lib/timer/audio";
import { type Form, type Mode, MAX_SECONDS, clamp, fromPreset, presetBody, sanitize } from "@/lib/timer/form";
import { type Preset, usePresets } from "@/lib/timer/usePresets";
import { AudioControls } from "./AudioControls";

const FIELD = "min-h-14 w-20 rounded-xl border border-[#2B3A5E] bg-[#0B1220] px-3 text-center text-xl tabular-nums";
const CARD = "rounded-2xl border border-[#2B3A5E] bg-[#131C33] p-4";
const MODES: [Mode, string][] = [["rounds", "Runden"], ["countdown", "Countdown"], ["stopwatch", "Stoppuhr"]];

function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <input type="number" inputMode="numeric" className={FIELD} min={min} max={max} value={value}
        onChange={(e) => onChange(clamp(Number(e.target.value), min, max))} />
    </label>
  );
}

function Time({ label, value, min = 0, onChange }: { label: string; value: number; min?: number; onChange: (s: number) => void }) {
  const m = Math.floor(value / 60), s = value % 60;
  const set = (mm: number, ss: number) => onChange(clamp(mm * 60 + ss, min, MAX_SECONDS));
  return (
    <fieldset className="flex items-center justify-between gap-3">
      <legend className="sr-only">{label}</legend>
      <span aria-hidden>{label}</span>
      <span className="flex items-center gap-1">
        <input aria-label={`${label} Minuten`} type="number" inputMode="numeric" className={FIELD} min={0} max={99} value={m}
          onChange={(e) => set(clamp(Number(e.target.value), 0, 99), s)} />:
        <input aria-label={`${label} Sekunden`} type="number" inputMode="numeric" className={FIELD} min={0} max={59} value={s}
          onChange={(e) => set(m, clamp(Number(e.target.value), 0, 59))} />
      </span>
    </fieldset>
  );
}

export function Setup({ form, setForm, isAdmin, beeper, onStart }: {
  form: Form; setForm: (f: Form) => void; isAdmin: boolean; beeper: Beeper; onStart: () => void;
}) {
  const { presets, fromCache, refresh } = usePresets();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const upd = (p: Partial<Form>) => setForm(sanitize({ ...form, ...p }));

  const body = () => presetBody(form);
  const create = async () => {
    const { response, error } = await api.POST("/api/timer-presets", { body: { name, ...body(), sort_order: presets.length } });
    if (response.ok) { setName(""); setMsg(""); await refresh(); } else setMsg(errText(error, "Speichern fehlgeschlagen."));
  };
  const overwrite = async (p: Preset) => {
    const { response, error } = await api.PATCH("/api/timer-presets/{preset_id}", { params: { path: { preset_id: p.id } }, body: body() });
    if (response.ok) { setMsg(""); await refresh(); } else setMsg(errText(error, "Speichern fehlgeschlagen."));
  };
  const remove = async (p: Preset) => {
    if (!confirm(`Preset „${p.name}“ löschen?`)) return;
    const { response } = await api.DELETE("/api/timer-presets/{preset_id}", { params: { path: { preset_id: p.id } } });
    if (response.ok) await refresh(); else setMsg("Löschen fehlgeschlagen.");
  };

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">Gym-Timer</h1>
      <div role="tablist" aria-label="Modus" className="grid grid-cols-3 gap-2">
        {MODES.map(([m, l]) => (
          <button key={m} role="tab" aria-selected={form.mode === m} onClick={() => upd({ mode: m })}
            className={`min-h-14 rounded-xl border text-lg ${form.mode === m ? "border-[#7FA2FF] bg-[#2454E0] text-white" : "border-[#2B3A5E] bg-[#131C33]"}`}>{l}</button>
        ))}
      </div>

      <div className={`${CARD} flex flex-col gap-3`}>
        {form.mode === "rounds" && (
          <>
            <Num label="Runden" value={form.rounds} min={1} max={99} onChange={(rounds) => upd({ rounds })} />
            <Time label="Arbeitszeit" value={form.work} min={1} onChange={(work) => upd({ work })} />
            <Time label="Pause" value={form.rest} onChange={(rest) => upd({ rest })} />
            <Time label="Vorbereitung" value={form.prep} onChange={(prep) => upd({ prep })} />
          </>
        )}
        {form.mode === "countdown" && <Time label="Dauer" value={form.duration} min={1} onChange={(duration) => upd({ duration })} />}
        {form.mode === "stopwatch" && <p className="text-[#9FB0D6]">Zählt hoch. Start, Pause und Reset im Timer.</p>}
      </div>

      <button className="min-h-[88px] rounded-2xl bg-[#2454E0] text-2xl font-bold text-white" onClick={() => { beeper.unlock(); onStart(); }}>
        Start
      </button>

      <section className={`${CARD} flex flex-col gap-3`} aria-labelledby="presets">
        <h2 id="presets" className="text-lg font-semibold">Team-Presets</h2>
        {fromCache && <p className="text-sm text-[#9FB0D6]">Offline: zuletzt gespeicherte Presets.</p>}
        {msg && <p role="alert" className="rounded-lg bg-danger-soft p-2 text-danger">{msg}</p>}
        {presets.length === 0 && <p className="text-[#9FB0D6]">Keine Presets vorhanden.</p>}
        <ul className="flex flex-col gap-2">
          {presets.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2">
              <button className="min-h-14 flex-1 rounded-xl border border-[#2B3A5E] bg-[#0B1220] px-4 text-left text-lg" onClick={() => setForm(fromPreset(p))}>{p.name}</button>
              {isAdmin && !fromCache && (
                <>
                  <button className="min-h-14 rounded-xl border border-[#2B3A5E] px-3" onClick={() => overwrite(p)} aria-label={`${p.name} mit aktueller Einstellung überschreiben`}>Überschreiben</button>
                  <button className="min-h-14 rounded-xl border border-[#EF4444] px-3 text-[#FCA5A5]" onClick={() => remove(p)} aria-label={`${p.name} löschen`}>Löschen</button>
                </>
              )}
            </li>
          ))}
        </ul>
        {isAdmin && !fromCache && (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder="Name für neues Preset" aria-label="Preset-Name"
              className="min-h-14 flex-1 rounded-xl border border-[#2B3A5E] bg-[#0B1220] px-3" />
            <button className="min-h-14 rounded-xl border border-[#7FA2FF] px-4">Als Preset speichern</button>
          </form>
        )}
      </section>

      <section className={CARD}><AudioControls beeper={beeper} /></section>
    </main>
  );
}
