// Pure timer state machine: no DOM, injectable clock (ms, monotonic like performance.now()).
// Phase ends are absolute timestamps chained from one another, so there is no tick-sum drift
// and a large time jump (backgrounded tab) is resolved exactly on the next tick().

export type Config =
  | { mode: "rounds"; rounds: number; work: number; rest: number; prep: number } // seconds
  | { mode: "countdown"; duration: number }
  | { mode: "stopwatch" };

export type PhaseKind = "prep" | "work" | "rest";
export type Kind = PhaseKind | "done";
export type Phase = { kind: PhaseKind; round: number; durationMs: number };
export type PhaseEvent = { from: Kind; to: Kind; at: number };
export type Status = "idle" | "running" | "paused" | "finished";
export type Snapshot = {
  status: Status;
  kind: Kind;
  round: number;
  totalRounds: number;
  /** countdown remaining, or elapsed for the stopwatch */
  displayMs: number;
  remainingMs: number;
  phaseDurationMs: number;
  events: PhaseEvent[];
};
export type Clock = () => number;

const MS = 1000;

export function buildPhases(c: Config): Phase[] {
  if (c.mode === "stopwatch") return [];
  if (c.mode === "countdown") return [{ kind: "work", round: 1, durationMs: c.duration * MS }];
  const out: Phase[] = [];
  if (c.prep > 0) out.push({ kind: "prep", round: 0, durationMs: c.prep * MS });
  for (let r = 1; r <= c.rounds; r++) {
    out.push({ kind: "work", round: r, durationMs: c.work * MS });
    if (c.rest > 0 && r < c.rounds) out.push({ kind: "rest", round: r, durationMs: c.rest * MS });
  }
  return out;
}

export class TimerEngine {
  private phases: Phase[];
  private index = 0;
  private status: Status = "idle";
  private phaseEnd = 0; // absolute, while running
  private remaining = 0; // while idle/paused
  private swAcc = 0;
  private swStart = 0;
  private pending: PhaseEvent[] = [];

  constructor(private config: Config, private now: Clock) {
    this.phases = buildPhases(config);
    this.remaining = this.phases[0]?.durationMs ?? 0;
  }

  private get stopwatch() { return this.config.mode === "stopwatch"; }
  private get kind(): Kind { return this.status === "finished" ? "done" : (this.phases[this.index]?.kind ?? "work"); }

  start() {
    if (this.status === "running" || this.status === "finished") return;
    const now = this.now();
    if (this.stopwatch) this.swStart = now;
    else this.phaseEnd = now + this.remaining;
    this.status = "running";
  }

  pause() {
    this.advance();
    if (this.status !== "running") return;
    const now = this.now();
    if (this.stopwatch) this.swAcc += now - this.swStart;
    else this.remaining = Math.max(0, this.phaseEnd - now);
    this.status = "paused";
  }

  reset() {
    this.status = "idle";
    this.index = 0;
    this.swAcc = 0;
    this.pending = [];
    this.remaining = this.phases[0]?.durationMs ?? 0;
  }

  /** dir > 0: next phase, dir < 0: previous phase (or restart the first one). */
  skip(dir: 1 | -1) {
    this.advance();
    if (this.stopwatch || this.status === "finished") return;
    const now = this.now();
    const from = this.kind;
    const next = this.index + dir;
    if (next >= this.phases.length) {
      this.status = "finished";
      this.pending.push({ from, to: "done", at: now });
      return;
    }
    this.index = Math.max(0, next);
    const dur = this.phases[this.index].durationMs;
    if (this.status === "running") this.phaseEnd = now + dur; else this.remaining = dur;
    this.pending.push({ from, to: this.kind, at: now });
  }

  /** Shift the current phase's remaining time by deltaMs (e.g. +-10 s). */
  adjust(deltaMs: number) {
    this.advance();
    if (this.stopwatch || this.status === "finished") return;
    if (this.status === "running") this.phaseEnd = Math.max(this.now(), this.phaseEnd + deltaMs);
    else this.remaining = Math.max(0, this.remaining + deltaMs);
  }

  private advance() {
    if (this.status !== "running" || this.stopwatch) return;
    const now = this.now();
    while (now >= this.phaseEnd) {
      const from = this.kind;
      const at = this.phaseEnd;
      this.index++;
      if (this.index >= this.phases.length) {
        this.index = this.phases.length - 1;
        this.status = "finished";
        this.pending.push({ from, to: "done", at });
        return;
      }
      this.phaseEnd = at + this.phases[this.index].durationMs;
      this.pending.push({ from, to: this.kind, at });
    }
  }

  tick(): Snapshot {
    this.advance();
    const now = this.now();
    const phase = this.phases[this.index];
    let remainingMs = 0;
    if (this.status === "running") remainingMs = this.stopwatch ? 0 : Math.max(0, this.phaseEnd - now);
    else if (this.status !== "finished") remainingMs = this.remaining;
    const elapsed = this.swAcc + (this.status === "running" ? now - this.swStart : 0);
    const events = this.pending;
    this.pending = [];
    return {
      status: this.status,
      kind: this.kind,
      round: phase?.round ?? 0,
      totalRounds: this.config.mode === "rounds" ? this.config.rounds : this.stopwatch ? 0 : 1,
      displayMs: this.stopwatch ? elapsed : remainingMs,
      remainingMs,
      phaseDurationMs: phase?.durationMs ?? 0,
      events,
    };
  }
}
