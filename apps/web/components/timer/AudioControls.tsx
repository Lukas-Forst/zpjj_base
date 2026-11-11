"use client";
import { Volume2, VolumeX } from "lucide-react";
import { useState } from "react";
import { type Beeper, SOUNDS, type SoundId, isSoundId } from "@/lib/timer/audio";
import { KEYS, load, save } from "@/lib/timer/storage";

export function loadAudio(b: Beeper) {
  const a = load<Record<string, unknown>>(KEYS.audio, {});
  b.set(typeof a.volume === "number" ? a.volume : 0.7, !!a.muted);
  b.setSounds(isSoundId(a.start) ? a.start : b.startSound, isSoundId(a.rest) ? a.rest : b.restSound);
}

const SELECT = "min-h-12 border border-night-border bg-night px-2 text-night-text";

export function AudioControls({ beeper }: { beeper: Beeper }) {
  const [vol, setVol] = useState(beeper.volume);
  const [muted, setMuted] = useState(beeper.muted);
  const [start, setStart] = useState(beeper.startSound);
  const [rest, setRest] = useState(beeper.restSound);
  const persist = (o: { volume?: number; muted?: boolean; start?: SoundId; rest?: SoundId }) => {
    const n = { volume: vol, muted, start, rest, ...o };
    beeper.set(n.volume, n.muted);
    beeper.setSounds(n.start, n.rest);
    setVol(n.volume); setMuted(n.muted); setStart(n.start); setRest(n.rest);
    save(KEYS.audio, n);
  };
  // Selecting is a user gesture: unlock audio and preview the sound.
  const pick = (kind: "start" | "rest", v: string) => {
    if (!isSoundId(v)) return;
    persist({ [kind]: v });
    beeper.unlock();
    beeper.play(v);
  };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" aria-pressed={muted} onClick={() => persist({ muted: !muted })}
        className="inline-flex min-h-12 min-w-12 items-center gap-2 border border-night-border bg-night-surface px-3 font-semibold">
        {muted ? <VolumeX size={18} strokeWidth={1.75} aria-hidden /> : <Volume2 size={18} strokeWidth={1.75} aria-hidden />}{muted ? "Stumm" : "Ton"}
      </button>
      <label className="flex items-center gap-2 text-sm text-night-muted">
        Lautstärke
        <input type="range" min={0} max={1} step={0.05} value={vol} aria-label="Lautstärke"
          onChange={(e) => persist({ volume: Number(e.target.value) })} />
      </label>
      <label className="flex items-center gap-2 text-sm text-night-muted">
        Ton Rundenstart
        <select className={SELECT} value={start} onChange={(e) => pick("start", e.target.value)}>
          {Object.entries(SOUNDS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-night-muted">
        Ton Pause
        <select className={SELECT} value={rest} onChange={(e) => pick("rest", e.target.value)}>
          {Object.entries(SOUNDS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}
        </select>
      </label>
    </div>
  );
}
