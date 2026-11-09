"use client";
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
    <div ref={root} className="min-h-[calc(100dvh-4.5rem)]">
      {running
        ? <Run config={toConfig(form)} beeper={beeper} onExit={() => setRunning(false)} fsRef={root} />
        : <Setup form={form} setForm={setForm} isAdmin={me.role === "gesellschafter"} beeper={beeper} onStart={() => setRunning(true)} />}
    </div>
  );
}

export default function Page() {
  return <AppShell dark><Timer /></AppShell>;
}
