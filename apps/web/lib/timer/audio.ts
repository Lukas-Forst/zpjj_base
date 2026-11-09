export const SOUNDS = {
  buzzer: "Buzzer",
  glocke: "Glocke",
  gong: "Gong",
  ton: "Langer Ton",
  pieps: "Dreifach-Pieps",
} as const;
export type SoundId = keyof typeof SOUNDS;
export const isSoundId = (x: unknown): x is SoundId => typeof x === "string" && x in SOUNDS;

// All sounds are synthesized with WebAudio, no audio files. unlock() must run in a user gesture.
export class Beeper {
  private ctx?: AudioContext;
  private master?: GainNode;
  volume = 0.7;
  muted = false;
  startSound: SoundId = "buzzer";
  restSound: SoundId = "glocke";

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.apply();
    }
    void this.ctx.resume();
  }

  setSounds(start: SoundId, rest: SoundId) {
    this.startSound = start;
    this.restSound = rest;
  }

  set(volume: number, muted: boolean) {
    this.volume = volume;
    this.muted = muted;
    this.apply();
  }

  /** Volume and mute act immediately, also on sounds that are already playing. */
  apply() {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * 1.5; // headroom: loud in a gym
  }

  private tone(freq: number, at: number, dur: number) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  countdown() { this.tone(880, 0, 0.12); } // 3-2-1
  phase() { this.tone(660, 0, 0.7); } // long tone on phase change
  /** Pause start: boxing-style bell, three quick strikes (inharmonic partials, metallic decay). */
  private bell() {
    if (!this.ctx || !this.master) return;
    const c = this.ctx, base = 587; // D5
    const partials: [number, number, number][] = [[1, 1, 1.1], [2.76, 0.55, 0.7], [5.4, 0.3, 0.4], [8.93, 0.15, 0.25]];
    for (const at of [0, 0.28, 0.56]) {
      const t = c.currentTime + at;
      for (const [ratio, vol, decay] of partials) {
        const o = c.createOscillator(), g = c.createGain();
        o.frequency.value = base * ratio;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5 * vol, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        o.connect(g).connect(this.master);
        o.start(t); o.stop(t + decay + 0.02);
      }
    }
  }
  /** Round start: one short arena-style buzzer (~295 Hz, buzzy). */
  private buzzer() {
    if (!this.ctx || !this.master) return;
    const c = this.ctx, t = c.currentTime, dur = 0.65;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3000;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    g.gain.setValueAtTime(0.35, t + dur - 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g).connect(this.master);
    for (const f of [294, 298, 588, 882]) {
      const o = c.createOscillator();
      o.type = "square";
      o.frequency.value = f;
      o.connect(lp);
      o.start(t); o.stop(t + dur + 0.02);
    }
  }
  gong() { this.tone(330, 0, 1.2); this.tone(330, 0.9, 1.4); } // double gong, also end of the session
  private triple() { for (const at of [0, 0.25, 0.5]) this.tone(988, at, 0.15); }

  play(id: SoundId) {
    ({ buzzer: () => this.buzzer(), glocke: () => this.bell(), gong: () => this.gong(), ton: () => this.phase(), pieps: () => this.triple() })[id]();
  }
  roundStart() { this.play(this.startSound); }
  rest() { this.play(this.restSound); }
  vibrate(ms: number | number[]) {
    if (!this.muted && "vibrate" in navigator) navigator.vibrate(ms);
  }
}
