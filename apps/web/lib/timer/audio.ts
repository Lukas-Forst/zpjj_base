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
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
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
  gong() { this.tone(330, 0, 1.2); this.tone(330, 0.9, 1.4); } // double gong at the end
  vibrate(ms: number | number[]) {
    if (!this.muted && "vibrate" in navigator) navigator.vibrate(ms);
  }
}
