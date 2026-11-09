"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Beeper } from "@/lib/timer/audio";
import { type Config, type Kind, type Snapshot, TimerEngine } from "@/lib/timer/engine";
import { fmt } from "@/lib/timer/fmt";
import { useWakeLock } from "@/lib/timer/useWakeLock";
import { AudioControls } from "./AudioControls";

const COLOR = { prep: "#F5B942", work: "#7FA2FF", rest: "#64748B", done: "#7FA2FF" } as const;
const LABEL: Record<Kind, string> = { prep: "VORBEREITUNG", work: "ARBEIT", rest: "PAUSE", done: "FERTIG" };
const BTN = "min-h-14 min-w-14 rounded-xl border border-[#2B3A5E] bg-[#131C33] px-4 text-lg";

function Segments({ s }: { s: Snapshot }) {
  if (s.totalRounds < 2) return null;
  return (
    <div className="flex w-full gap-1" role="img" aria-label={`Runde ${Math.max(1, s.round)} von ${s.totalRounds}`}>
      {Array.from({ length: s.totalRounds }, (_, i) => {
        const r = i + 1;
        const done = s.kind === "done" || r < s.round || (s.kind === "rest" && r === s.round);
        const active = !done && s.kind === "work" && r === s.round;
        return <span key={r} className="h-3 flex-1 rounded-full" style={{ background: done ? "#2454E0" : active ? "#7FA2FF" : "#2B3A5E" }} />;
      })}
    </div>
  );
}

export function Run({ config, beeper, onExit, fsRef }: { config: Config; beeper: Beeper; onExit: () => void; fsRef: React.RefObject<HTMLElement | null> }) {
  const [engine] = useState(() => new TimerEngine(config, () => performance.now()));
  const [snap, setSnap] = useState<Snapshot>(() => engine.tick());
  const [announce, setAnnounce] = useState("");
  const lastBeep = useRef("");
  const stopwatch = config.mode === "stopwatch";

  const step = useCallback(() => {
    const s = engine.tick();
    setSnap(s);
    if (s.events.length) {
      const to = s.events[s.events.length - 1].to;
      if (to === "done") { beeper.gong(); beeper.vibrate([200, 100, 200]); } else { beeper.phase(); beeper.vibrate(200); }
      setAnnounce(LABEL[to]);
    } else if (s.status === "running" && !stopwatch) {
      const sec = Math.ceil(s.remainingMs / 1000);
      const key = `${s.kind}-${s.round}-${sec}`;
      if (sec >= 1 && sec <= 3 && key !== lastBeep.current) { lastBeep.current = key; beeper.countdown(); }
    }
  }, [engine, beeper, stopwatch]);

  useEffect(() => {
    engine.start();
    step();
    const id = setInterval(step, 100);
    document.addEventListener("visibilitychange", step);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", step); };
  }, [engine, step]);

  const { supported } = useWakeLock(snap.status === "running");
  const run = (fn: () => void) => () => { fn(); step(); };
  const toggle = run(() => {
    if (snap.status === "running") engine.pause();
    else { if (snap.status === "finished") engine.reset(); engine.start(); }
  });
  const reset = run(() => engine.reset());
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void fsRef.current?.requestFullscreen?.();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)) return;
      const k = e.key.toLowerCase();
      if (![" ", "r", "f", "arrowleft", "arrowright"].includes(k)) return;
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      if (k === " ") toggle();
      else if (k === "r") reset();
      else if (k === "f") fullscreen();
      else if (!stopwatch) { engine.skip(k === "arrowright" ? 1 : -1); step(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const kind = snap.kind;
  const label = stopwatch ? "STOPPUHR" : LABEL[kind];
  const pulse = snap.status === "running" && kind === "work" && !stopwatch && snap.remainingMs <= 10_000;
  const mainLabel = snap.status === "running" ? "Pause" : snap.status === "paused" ? "Fortsetzen" : snap.status === "finished" ? "Neu starten" : "Start";

  return (
    <section className="flex min-h-[calc(100dvh-4.5rem)] flex-col gap-4 p-4" aria-label="Timer">
      <p className="sr-only" aria-live="polite">{announce}</p>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-3xl font-bold tracking-wide" style={{ color: COLOR[kind] }}>{label}</span>
        {snap.totalRounds > 1 && <span className="text-3xl font-semibold">Runde {Math.max(1, snap.round)}/{snap.totalRounds}</span>}
      </div>
      <Segments s={snap} />
      <div className="flex flex-1 items-center justify-center">
        <div
          className={`font-bold leading-none tabular-nums ${pulse ? "timer-last10" : ""}`}
          style={{ fontSize: "min(44vh, 26vw)", color: pulse ? undefined : "#F4F7FF" }}
          aria-hidden
        >
          {fmt(snap.displayMs, !stopwatch)}
        </div>
      </div>
      {!supported && snap.status === "running" && <p className="text-sm text-[#9FB0D6]">Bildschirm bitte manuell anlassen</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button className="min-h-[88px] min-w-48 flex-1 rounded-2xl bg-[#2454E0] text-2xl font-bold text-white" onClick={toggle}>{mainLabel}</button>
        <button className={BTN} onClick={reset}>Reset</button>
        {!stopwatch && (
          <>
            <button className={BTN} aria-label="Vorherige Phase" onClick={run(() => engine.skip(-1))}>⏮</button>
            <button className={BTN} aria-label="Nächste Phase" onClick={run(() => engine.skip(1))}>⏭</button>
            <button className={BTN} onClick={run(() => engine.adjust(-10_000))}>−10 s</button>
            <button className={BTN} onClick={run(() => engine.adjust(10_000))}>+10 s</button>
          </>
        )}
        <button className={BTN} onClick={fullscreen}>Vollbild</button>
        <button className={BTN} onClick={onExit}>Einstellungen</button>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#2B3A5E] pt-3 text-sm text-[#9FB0D6]">
        <AudioControls beeper={beeper} />
        <span className="flex flex-wrap gap-3">
          {(["prep", "work", "rest"] as const).map((k) => (
            <span key={k} className="flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-full" style={{ background: COLOR[k] }} />{LABEL[k]}</span>
          ))}
        </span>
        <span>Leertaste Start/Pause · R Reset · F Vollbild · ←/→ Phase</span>
      </footer>
    </section>
  );
}
