"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { AppShell, useCurrentMe } from "@/components/AppShell";
import { loadAudio } from "@/components/timer/AudioControls";
import { Run } from "@/components/timer/Run";
import { Setup } from "@/components/timer/Setup";
import { Beeper } from "@/lib/timer/audio";
import { DEFAULT_FORM, type Form, sanitize, toConfig } from "@/lib/timer/form";
import { KEYS, load, save } from "@/lib/timer/storage";


function Timer() {
  const me = useCurrentMe();
  const root = useRef<HTMLDivElement>(null);
  const [beeper] = useState(() => { const b = new Beeper(); if (typeof window !== "undefined") loadAudio(b); return b; });
  const [form, setFormState] = useState<Form>(() => (typeof window === "undefined" ? DEFAULT_FORM : sanitize({ ...DEFAULT_FORM, ...load<Partial<Form>>(KEYS.last, {}) })));
  const [running, setRunning] = useState(false);
  const setForm = (f: Form) => { setFormState(f); save(KEYS.last, f); };
  return (
    <div ref={root} className="min-h-dvh bg-night text-night-text">
      <header className="mx-auto flex h-[60px] max-w-5xl items-center justify-between px-5">
        {running
          ? <button onClick={() => setRunning(false)} className="inline-flex min-h-11 items-center gap-2"><ArrowLeft size={20} strokeWidth={1.75} aria-hidden />Zurück</button>
          : <Link href="/" className="inline-flex min-h-11 items-center gap-2"><ArrowLeft size={20} strokeWidth={1.75} aria-hidden />Zurück</Link>}
        <span className="text-[13px] font-semibold uppercase tracking-[0.1em] text-night-muted">Gym-Timer</span>
      </header>
      {running
        ? <Run config={toConfig(form)} beeper={beeper} onExit={() => setRunning(false)} fsRef={root} />
        : <Setup form={form} setForm={setForm} isAdmin={me.role === "gesellschafter"} beeper={beeper} onStart={() => setRunning(true)} />}
    </div>
  );
}

export default function Page() {
  return <AppShell bare><Timer /></AppShell>;
}
