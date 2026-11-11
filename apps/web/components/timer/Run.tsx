"use client";
import { Maximize, Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Beeper } from "@/lib/timer/audio";
import { type Config, type Kind, type Snapshot, TimerEngine } from "@/lib/timer/engine";
import { fmt } from "@/lib/timer/fmt";
import { useWakeLock } from "@/lib/timer/useWakeLock";
import { AudioControls } from "./AudioControls";

const TEXT = { prep: "text-warn", work: "text-night-label", rest: "text-night-muted", done: "text-night-label" } as const;
const DOT = { prep: "bg-warn", work: "bg-action", rest: "bg-rest-slate" } as const;
const LABEL: Record<Kind, string> = { prep: "VORBEREITUNG", work: "ARBEIT", rest: "PAUSE", done: "FERTIG" };
const BTN = "inline-flex min-h-12 min-w-12 items-center justify-center gap-2 border border-night-border bg-night-surface px-4 text-base font-semibold";
const clock = (s: number) => fmt(s * 1000).replace(/^0/, "");

function Segments({ s }: { s: Snapshot }) {
  if (s.totalRounds < 2) return null;
  return (
    <div className="flex w-full gap-1.5" role="img" aria-label={`Runde ${Math.max(1, s.round)} von ${s.totalRounds}`}>
      {Array.from({ length: s.totalRounds }, (_, i) => {
        const r = i + 1;
        const done = s.kind === "done" || r < s.round || (s.kind === "rest" && r === s.round);
        const active = !done && s.kind === "work" && r === s.round;
        return <span key={r} className={`h-1.5 flex-1 ${done || active ? "bg-action" : "bg-night-border"}`} />;
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
      if (to === "done") { beeper.gong(); beeper.vibrate([200, 100, 200]); }
      else if (to === "work") { beeper.roundStart(); beeper.vibrate(400); } // round start
      else if (to === "rest") { beeper.rest(); beeper.vibrate([150, 80, 150]); }
      else { beeper.phase(); beeper.vibrate(200); }
      setAnnounce(LABEL[to]);
    } else if (s.status === "running" && !stopwatch) {
      const sec = Math.ceil(s.remainingMs / 1000);
      const key = `${s.kind}-${s.round}-${sec}`;
      if (sec >= 1 && sec <= 3 && key !== lastBeep.current) { lastBeep.current = key; beeper.countdown(); }
    }
  }, [engine, beeper, stopwatch]);

  useEffect(() => {
    engine.start();
    if (engine.tick().kind === "work") beeper.roundStart(); // no preparation phase: the run itself starts a round
    step();
    const id = setInterval(step, 100);
    document.addEventListener("visibilitychange", step);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", step); };
  }, [engine, step, beeper]);

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
  const mainLabel = snap.status === "running" ? "Pause" : snap.status === "paused" ? "Fortsetzen" : snap.status === "finished" ? "Neu starten" : "Starten";

  const phase = stopwatch ? "STOPPUHR" : snap.totalRounds > 1 && kind !== "done" ? `${label} · RUNDE ${Math.max(1, snap.round)} VON ${snap.totalRounds}` : label;
  const Icon = snap.status === "running" ? Pause : Play;

  return (
    <section className="mx-auto flex min-h-[calc(100dvh-60px)] max-w-5xl flex-col gap-5 px-5 pb-6" aria-label="Timer">
      <p className="sr-only" aria-live="polite">{announce}</p>
      <div className="flex items-center gap-2">
        {kind !== "done" && !stopwatch && <span aria-hidden className={`size-2 ${DOT[kind]}`} />}
        <span className={`text-[13px] font-semibold uppercase tracking-[0.14em] ${TEXT[kind]}`}>{phase}</span>
      </div>
      <Segments s={snap} />
      <div className="flex flex-1 items-center justify-center">
        <div
          className={`font-mono font-bold leading-none tabular-nums tracking-[-0.04em] text-[min(30vw,120px)] md:text-[min(44vh,26vw)] ${pulse ? "timer-last10" : "text-night-text"}`}
          aria-hidden
        >
          {fmt(snap.displayMs, !stopwatch)}
        </div>
      </div>
      {config.mode === "rounds" && (
        <dl className="grid grid-cols-3 border-y border-night-border text-center">
          {([["Runden", String(config.rounds)], ["Arbeit", clock(config.work)], ["Pause", clock(config.rest)]] as const).map(([k, v], i) => (
            <div key={k} className={`py-2 ${i ? "border-l border-night-border" : ""}`}>
              <dt className="text-xs text-night-muted">{k}</dt>
              <dd className="font-mono text-lg font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <button className="flex min-h-[72px] w-full items-center justify-center gap-3 bg-action text-[22px] font-bold text-action-ink" onClick={toggle}>
        <Icon size={24} strokeWidth={1.75} aria-hidden />{mainLabel}
      </button>
      <div className="flex flex-wrap gap-2">
        <button className={BTN} onClick={reset}><RotateCcw size={18} strokeWidth={1.75} aria-hidden />Zurücksetzen</button>
        {!stopwatch && (
          <>
            <button className={BTN} aria-label="Vorherige Phase" onClick={run(() => engine.skip(-1))}><SkipBack size={18} strokeWidth={1.75} aria-hidden /></button>
            <button className={BTN} aria-label="Nächste Phase" onClick={run(() => engine.skip(1))}><SkipForward size={18} strokeWidth={1.75} aria-hidden /></button>
            <button className={BTN} onClick={run(() => engine.adjust(-10_000))}>−10 s</button>
            <button className={BTN} onClick={run(() => engine.adjust(10_000))}>+10 s</button>
          </>
        )}
        <button className={BTN} onClick={fullscreen}><Maximize size={18} strokeWidth={1.75} aria-hidden />Vollbild</button>
        <button className={BTN} onClick={onExit}>Einstellungen</button>
      </div>
      <footer className="flex flex-col gap-3 border-t border-night-border pt-3 text-xs text-night-muted">
        <AudioControls beeper={beeper} />
        <p>{[supported ? "Bildschirm bleibt an" : "Bildschirm bitte manuell anlassen", beeper.muted ? "Ton aus" : "Ton aktiv"].join(" · ")}</p>
        <p className="hidden md:block">Leertaste Start/Pause · R Zurücksetzen · F Vollbild · ←/→ Phase</p>
      </footer>
    </section>
  );
}
