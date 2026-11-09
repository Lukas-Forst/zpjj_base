import type { Config } from "./engine";

export type Mode = Config["mode"];
export type Form = { mode: Mode; rounds: number; work: number; rest: number; prep: number; duration: number };

export const MAX_SECONDS = 99 * 60 + 59;
export const DEFAULT_FORM: Form = { mode: "rounds", rounds: 5, work: 300, rest: 30, prep: 10, duration: 300 };

export const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo);

export function sanitize(f: Form): Form {
  return {
    mode: f.mode,
    rounds: clamp(f.rounds, 1, 99),
    work: clamp(f.work, 1, MAX_SECONDS),
    rest: clamp(f.rest, 0, MAX_SECONDS),
    prep: clamp(f.prep, 0, MAX_SECONDS),
    duration: clamp(f.duration, 1, MAX_SECONDS),
  };
}

export function toConfig(raw: Form): Config {
  const f = sanitize(raw);
  if (f.mode === "rounds") return { mode: "rounds", rounds: f.rounds, work: f.work, rest: f.rest, prep: f.prep };
  if (f.mode === "countdown") return { mode: "countdown", duration: f.duration };
  return { mode: "stopwatch" };
}

/** Preset config is untyped JSON from the API (or an old cache): merge over defaults, then clamp. */
export function fromPreset(p: { mode: string; config: Record<string, unknown> }): Form {
  const mode: Mode = p.mode === "countdown" || p.mode === "stopwatch" ? p.mode : "rounds";
  const num = (k: string, d: number) => (typeof p.config[k] === "number" ? (p.config[k] as number) : d);
  return sanitize({
    mode,
    rounds: num("rounds", DEFAULT_FORM.rounds),
    work: num("work", DEFAULT_FORM.work),
    rest: num("rest", DEFAULT_FORM.rest),
    prep: num("prep", DEFAULT_FORM.prep),
    duration: num("duration", DEFAULT_FORM.duration),
  });
}
