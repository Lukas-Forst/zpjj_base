import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Beeper, SOUNDS, isSoundId } from "@/lib/timer/audio";

type Node = { connect: (n?: unknown) => unknown; start?: () => void; stop?: () => void };
const started: string[] = [];

class FakeCtx {
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {});
  decodeAudioData = vi.fn(async () => ({ duration: 1.2 }));
  private node(kind: string): Node & Record<string, unknown> {
    const n: Node & Record<string, unknown> = {
      connect: (x?: unknown) => x ?? n,
      start: () => { started.push(kind); },
      stop: () => {},
      frequency: { value: 0 },
      gain: { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
    };
    return n;
  }
  createGain() { return this.node("gain"); }
  createOscillator() { return this.node("osc"); }
  createBiquadFilter() { return this.node("filter"); }
  createBufferSource() { return this.node("file"); }
}

const fetchOk = () => vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));

beforeEach(() => {
  started.length = 0;
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
});
afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(window, "AudioContext"); });

describe("start.mp3 as a selectable sound", () => {
  it("is a known sound with a readable label", () => {
    expect(isSoundId("start")).toBe(true);
    expect(SOUNDS.start).toMatch(/Start/);
  });

  it("plays the decoded file once it is loaded", async () => {
    const f = fetchOk();
    vi.stubGlobal("fetch", f);
    const b = new Beeper();
    b.unlock(); // starts the preload inside the user gesture
    await b.ready();
    expect(f).toHaveBeenCalledWith("/sounds/start.mp3");
    b.play("start");
    expect(started).toEqual(["file"]);
  });

  it("falls back to the buzzer instead of staying silent while the file is not loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const b = new Beeper();
    b.unlock();
    await b.ready();
    b.play("start");
    expect(started).not.toContain("file");
    expect(started).toContain("osc"); // buzzer is made of oscillators
  });

  it("does not fetch the file twice", async () => {
    const f = fetchOk();
    vi.stubGlobal("fetch", f);
    const b = new Beeper();
    b.unlock();
    b.unlock();
    await b.ready();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
