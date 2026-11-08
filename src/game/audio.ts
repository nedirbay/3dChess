/** Tiny Web Audio synthesiser for stone-on-stone sound effects. */
export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: ConvolverNode | null = null;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      // Long, dark cathedral reverb from a decaying noise impulse.
      this.reverb = this.ctx.createConvolver();
      const len = this.ctx.sampleRate * 3.2;
      const ir = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      this.reverb.buffer = ir;
      const wet = this.ctx.createGain();
      wet.gain.value = 0.35;
      this.reverb.connect(wet).connect(this.master);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private out(node: AudioNode): void {
    node.connect(this.master!);
    node.connect(this.reverb!);
  }

  private noise(ctx: AudioContext, duration: number): AudioBufferSourceNode {
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  /** Heavy stone piece set down. */
  thud(strength = 1): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.6 * strength, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(g);
    this.out(g);
    osc.start(t);
    osc.stop(t + 0.32);

    const n = this.noise(ctx, 0.12);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.25 * strength, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    n.connect(f).connect(ng);
    this.out(ng);
    n.start(t);
  }

  /** Whoosh of a strike. */
  swing(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = this.noise(ctx, 0.35);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.33);
    n.connect(f).connect(g);
    this.out(g);
    n.start(t);
  }

  /** Stone shattering: sharp crack plus a shower of tinkling fragments. */
  shatter(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = this.noise(ctx, 0.8);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    n.connect(hp).connect(g);
    this.out(g);
    n.start(t);

    const boom = ctx.createOscillator();
    boom.frequency.setValueAtTime(90, t);
    boom.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.7, t);
    bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    boom.connect(bg);
    this.out(bg);
    boom.start(t);
    boom.stop(t + 0.5);

    for (let i = 0; i < 14; i++) {
      const at = t + 0.05 + Math.random() * 0.9;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 2200 + Math.random() * 4200;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, at);
      og.gain.exponentialRampToValueAtTime(0.05 + Math.random() * 0.06, at + 0.004);
      og.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
      o.connect(og);
      this.out(og);
      o.start(at);
      o.stop(at + 0.1);
    }
  }

  /** Low bell toll for check / game end. */
  bell(low = false): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const base = low ? 110 : 220;
    for (const [ratio, amp] of [
      [1, 0.35],
      [2.01, 0.18],
      [2.76, 0.12],
      [5.4, 0.05],
    ]) {
      const o = ctx.createOscillator();
      o.frequency.value = base * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (low ? 3.5 : 2));
      o.connect(g);
      this.out(g);
      o.start(t);
      o.stop(t + 3.6);
    }
  }

  /** Soft click for UI selection. */
  tick(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.value = 880;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.08);
  }

  /** Shimmering chord for promotion / summoning. */
  arcane(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      const s = t + i * 0.06;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.08, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 1.4);
      o.connect(g);
      this.out(g);
      o.start(s);
      o.stop(s + 1.5);
    });
  }
}
