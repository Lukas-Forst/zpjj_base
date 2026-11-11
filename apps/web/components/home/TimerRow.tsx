"use client";
import Link from "next/link";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { fmt } from "@/lib/timer/fmt";
import { DEFAULT_FORM, type Form } from "@/lib/timer/form";
import { KEYS, load } from "@/lib/timer/storage";

const clock = (s: number) => fmt(s * 1000).replace(/^0/, "");
export function presetLabel(f: Form): string {
  if (f.mode === "rounds") return `${f.rounds} × ${clock(f.work)}`;
  if (f.mode === "countdown") return `Countdown ${clock(f.duration)}`;
  return "Stoppuhr";
}

export function TimerRow() {
  const [form, setForm] = useState<Form>(DEFAULT_FORM);
  useEffect(() => { setForm({ ...DEFAULT_FORM, ...load<Partial<Form>>(KEYS.last, {}) }); }, []);
  return (
    <Link href="/timer/" aria-label="Gym-Timer öffnen" className="flex items-center justify-between bg-ink px-4 py-3 text-paper">
      <span>
        <span className="block text-xs text-night-muted">Gym-Timer</span>
        <span className="font-mono text-lg font-semibold">{presetLabel(form)}</span>
      </span>
      <span className="flex size-11 items-center justify-center bg-action text-action-ink"><Play size={20} strokeWidth={1.75} aria-hidden /></span>
    </Link>
  );
}
