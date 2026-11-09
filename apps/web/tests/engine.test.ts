import { describe, expect, it } from "vitest";
import { type Config, TimerEngine, buildPhases } from "@/lib/timer/engine";

const S = 1000;
const rounds = (r: number, w: number, rest: number, prep = 0): Config => ({ mode: "rounds", rounds: r, work: w, rest, prep });

function setup(cfg: Config) {
  let t = 1_000_000; // arbitrary performance.now() origin
  const e = new TimerEngine(cfg, () => t);
  return { e, advance: (ms: number) => { t += ms; return e.tick(); }, now: () => t };
}

describe("buildPhases", () => {
  it("rounds: prep, work/rest alternating, no rest after the last round", () => {
    const p = buildPhases(rounds(3, 60, 20, 10));
    expect(p.map((x) => [x.kind, x.round, x.durationMs / S])).toEqual([
      ["prep", 0, 10], ["work", 1, 60], ["rest", 1, 20], ["work", 2, 60], ["rest", 2, 20], ["work", 3, 60],
    ]);
  });
  it("pause 0 skips rest phases, prep 0 skips prep", () => {
    expect(buildPhases(rounds(3, 60, 0, 0)).map((x) => x.kind)).toEqual(["work", "work", "work"]);
  });
  it("single round has no rest", () => {
    expect(buildPhases(rounds(1, 300, 30, 10)).map((x) => x.kind)).toEqual(["prep", "work"]);
  });
  it("99 rounds / 99:59", () => {
    const p = buildPhases(rounds(99, 5999, 5999, 0));
    expect(p).toHaveLength(99 + 98);
    expect(p[0].durationMs).toBe(5999 * S);
  });
  it("countdown is one work phase; stopwatch has none", () => {
    expect(buildPhases({ mode: "countdown", duration: 90 })).toHaveLength(1);
    expect(buildPhases({ mode: "stopwatch" })).toHaveLength(0);
  });
});

describe("TimerEngine rounds", () => {
  it("idle until started, then counts down", () => {
    const { e, advance } = setup(rounds(2, 10, 5, 3));
    expect(e.tick().status).toBe("idle");
    e.start();
    expect(e.tick()).toMatchObject({ status: "running", kind: "prep", remainingMs: 3 * S });
    const s = advance(1500);
    expect(s.remainingMs).toBe(1500);
  });

  it("emits phase events and finishes after last work (no trailing rest)", () => {
    const { e, advance } = setup(rounds(2, 10, 5, 0));
    e.start();
    expect(advance(10 * S).events.map((x) => x.to)).toEqual(["rest"]);
    expect(advance(5 * S).events.map((x) => x.to)).toEqual(["work"]);
    const end = advance(10 * S);
    expect(end.status).toBe("finished");
    expect(end.kind).toBe("done");
    expect(end.events.map((x) => x.to)).toEqual(["done"]);
    expect(advance(60 * S).events).toEqual([]); // stays finished
  });

  it("pause/resume neither loses nor adds time", () => {
    const { e, advance } = setup(rounds(1, 60, 0, 0));
    e.start();
    advance(20 * S);
    e.pause();
    expect(advance(3600 * S).remainingMs).toBe(40 * S); // paused for an hour
    e.start();
    expect(advance(39 * S).status).toBe("running");
    expect(advance(1 * S).status).toBe("finished");
  });

  it("large time jump (backgrounded tab) lands in the right phase with carried-over remainder", () => {
    const { e, advance } = setup(rounds(5, 300, 30, 10));
    e.start();
    // 10 prep + 300 work + 30 rest + 300 work = 640; jump to 650 -> 10s into rest 2... (work3? no)
    const s = advance(650 * S);
    expect(s).toMatchObject({ kind: "rest", round: 2 });
    expect(s.remainingMs).toBe(20 * S);
    expect(s.events.map((x) => x.to)).toEqual(["work", "rest", "work", "rest"]);
  });

  it("jump far beyond the end finishes", () => {
    const { e, advance } = setup(rounds(2, 10, 5, 0));
    e.start();
    expect(advance(10_000 * S).status).toBe("finished");
  });

  it("skip forward/back and +-10s", () => {
    const { e, advance } = setup(rounds(3, 60, 20, 0));
    e.start();
    advance(5 * S);
    e.skip(1);
    expect(e.tick()).toMatchObject({ kind: "rest", remainingMs: 20 * S });
    e.skip(-1);
    expect(e.tick()).toMatchObject({ kind: "work", round: 1, remainingMs: 60 * S });
    e.adjust(10 * S);
    expect(e.tick().remainingMs).toBe(70 * S);
    e.adjust(-100 * S);
    expect(e.tick().remainingMs).toBeGreaterThanOrEqual(0);
    e.skip(-1); // already at first phase: restarts it
    expect(e.tick()).toMatchObject({ kind: "work", round: 1, remainingMs: 60 * S });
  });

  it("skipping past the last phase finishes", () => {
    const { e } = setup(rounds(1, 60, 0, 0));
    e.start();
    e.skip(1);
    expect(e.tick().status).toBe("finished");
  });

  it("skip while paused keeps it paused", () => {
    const { e, advance } = setup(rounds(2, 60, 20, 0));
    e.start();
    advance(10 * S);
    e.pause();
    e.skip(1);
    advance(100 * S);
    expect(e.tick()).toMatchObject({ status: "paused", kind: "rest", remainingMs: 20 * S });
  });

  it("reset returns to idle", () => {
    const { e, advance } = setup(rounds(2, 60, 20, 5));
    e.start();
    advance(30 * S);
    e.reset();
    expect(e.tick()).toMatchObject({ status: "idle", kind: "prep", remainingMs: 5 * S });
  });
});

describe("drift", () => {
  it("5 x 5:00 / 0:30 over 27 min with jittery 100 ms ticks ends within 0.5 s, even with a pause", () => {
    const clock = { v: 5_000_000 };
    const startedAt = clock.v;
    const eng = new TimerEngine(rounds(5, 300, 30, 0), () => clock.v);
    eng.start();
    let finishedAt = -1;
    let pausedFor = 0;
    for (let i = 0; finishedAt < 0 && i < 100_000; i++) {
      clock.v += 100 + ((i * 37) % 13) - 6; // 94..106 ms jitter
      if (i === 5000) { eng.pause(); clock.v += 12_345; pausedFor = 12_345; eng.start(); }
      const s = eng.tick();
      if (s.status === "finished") finishedAt = s.events[s.events.length - 1].at;
    }
    const expected = 5 * 300 * S + 4 * 30 * S;
    expect(Math.abs(finishedAt - startedAt - pausedFor - expected)).toBeLessThan(500);
  });
});

describe("stopwatch / countdown", () => {
  it("stopwatch counts up, pauses, resets", () => {
    const { e, advance } = setup({ mode: "stopwatch" });
    e.start();
    expect(advance(61_500).displayMs).toBe(61_500);
    e.pause();
    expect(advance(10 * S).displayMs).toBe(61_500);
    e.start();
    expect(advance(500).displayMs).toBe(62 * S);
    e.reset();
    expect(e.tick()).toMatchObject({ status: "idle", displayMs: 0 });
  });
  it("countdown finishes and ignores skip-back below start", () => {
    const { e, advance } = setup({ mode: "countdown", duration: 300 });
    e.start();
    expect(advance(299 * S).status).toBe("running");
    expect(advance(1 * S).status).toBe("finished");
  });
});
