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
  /** Round start: loud trill whistle (~2.2 kHz, softer harmonic). */
  whistle() {
    if (!this.ctx || !this.master) return;
    const c = this.ctx, t = c.currentTime, dur = 0.9;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(1, t + 0.01);
    out.gain.setValueAtTime(1, t + dur - 0.1);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    out.connect(this.master);
    const lfo = c.createOscillator(), depth = c.createGain();
    lfo.frequency.value = 24;
    depth.gain.value = 140;
    lfo.connect(depth);
    for (const [f, vol] of [[2200, 1], [4400, 0.15]] as const) {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = f;
      g.gain.value = vol;
      depth.connect(o.frequency);
      o.connect(g).connect(out);
      o.start(t); o.stop(t + dur + 0.02);
    }
    lfo.start(t); lfo.stop(t + dur + 0.02);
  }
  gong() { this.tone(330, 0, 1.2); this.tone(330, 0.9, 1.4); } // double gong at the end
  vibrate(ms: number | number[]) {
    if (!this.muted && "vibrate" in navigator) navigator.vibrate(ms);
  }
}
