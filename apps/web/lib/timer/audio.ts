// All sounds are synthesized with WebAudio, no audio files. unlock() must run in a user gesture.
export class Beeper {
  private ctx?: AudioContext;
  private master?: GainNode;
  volume = 0.7;
  muted = false;

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
  /** Pause start: soft descending two-tone, clearly different from the round whistle. */
  rest() { this.tone(523, 0, 0.5); this.tone(392, 0.45, 0.9); }
  phase() { this.tone(660, 0, 0.7); } // long tone on phase change
  /** Round start: boxing-style bell, three quick strikes (inharmonic partials, metallic decay). */
  roundStart() {
    if (!this.ctx || !this.master) return;
    const c = this.ctx, base = 784;
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
  gong() { this.tone(330, 0, 1.2); this.tone(330, 0.9, 1.4); } // double gong at the end
  vibrate(ms: number | number[]) {
    if (!this.muted && "vibrate" in navigator) navigator.vibrate(ms);
  }
}
