"use client";
import { useState } from "react";
import type { Beeper } from "@/lib/timer/audio";
import { KEYS, load, save } from "@/lib/timer/storage";

export function loadAudio(b: Beeper) {
  const a = load(KEYS.audio, { volume: 0.7, muted: false });
  b.set(typeof a.volume === "number" ? a.volume : 0.7, !!a.muted);
}

export function AudioControls({ beeper }: { beeper: Beeper }) {
  const [vol, setVol] = useState(beeper.volume);
  const [muted, setMuted] = useState(beeper.muted);
  const commit = (volume: number, m: boolean) => {
    beeper.set(volume, m);
    setVol(volume); setMuted(m);
    save(KEYS.audio, { volume, muted: m });
  };
  return (
    <div className="flex items-center gap-3">
      <button type="button" aria-pressed={muted} onClick={() => commit(vol, !muted)}
        className="min-h-14 min-w-14 rounded-xl border border-[#2B3A5E] bg-[#131C33] px-3">
        {muted ? "🔇 Stumm" : "🔊 Ton"}
      </button>
      <label className="flex items-center gap-2 text-sm text-[#9FB0D6]">
        Lautstärke
        <input type="range" min={0} max={1} step={0.05} value={vol} aria-label="Lautstärke"
          onChange={(e) => commit(Number(e.target.value), muted)} />
      </label>
    </div>
  );
}
