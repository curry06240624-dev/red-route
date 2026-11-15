/* Red Route 3D walk: sound.
   Every sound is made by this code in the browser (Web Audio): a thin wind, the hum of the suit, breathing, steps and the
   alert tones. Nothing is a recording, and nothing is a recording from Mars. Sound starts only after a click or a key.
   AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md. */

export class Sound {
  constructor() { this.ctx = null; this.on = true; this.lastStep = 0; this.lastAlarm = 0; }
  // call from a click or key handler (browsers only let sound start from one)
  start() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain(); this.master.gain.value = this.on ? 0.55 : 0; this.master.connect(ctx.destination);
      const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      // wind: low, thin noise that swells slowly
      const wind = ctx.createBufferSource(); wind.buffer = buf; wind.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 380; lp.Q.value = 0.4;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 70;
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0.16;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lfoG = ctx.createGain(); lfoG.gain.value = 0.07;
      lfo.connect(lfoG); lfoG.connect(this.windGain.gain); lfo.start();
      const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.031; const lfo2G = ctx.createGain(); lfo2G.gain.value = 120;
      lfo2.connect(lfo2G); lfo2G.connect(lp.frequency); lfo2.start();
      wind.connect(lp); lp.connect(hp); hp.connect(this.windGain); this.windGain.connect(this.master); wind.start();
      // the suit: a faint hum
      for (const [f, g] of [[58, 0.02], [116, 0.007]]) { const o = ctx.createOscillator(); o.frequency.value = f; const og = ctx.createGain(); og.gain.value = g; o.connect(og); og.connect(this.master); o.start(); }
      // breathing: filtered noise, in and out
      const br = ctx.createBufferSource(); br.buffer = buf; br.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 950; bp.Q.value = 0.9;
      this.breath = ctx.createGain(); this.breath.gain.value = 0;
      br.connect(bp); bp.connect(this.breath); this.breath.connect(this.master); br.start();
      const cycle = () => {
        if (!this.ctx) return;
        const t = ctx.currentTime, g = this.breath.gain;
        g.cancelScheduledValues(t); g.setValueAtTime(0.0001, t);
        g.linearRampToValueAtTime(0.016, t + 1.3); g.linearRampToValueAtTime(0.002, t + 1.7);
        g.linearRampToValueAtTime(0.011, t + 2.9); g.linearRampToValueAtTime(0.0001, t + 3.9);
      };
      cycle(); this.timer = setInterval(cycle, 4300);
    } catch (e) { this.ctx = null; }
  }
  setOn(on) { this.on = on; if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.08); }
  step() {
    const ctx = this.ctx; if (!ctx || !this.on || ctx.state !== "running") return;
    const now = ctx.currentTime; if (now - this.lastStep < 0.3) return; this.lastStep = now;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 150 + Math.random() * 60;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.16, now + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    s.connect(lp); lp.connect(g); g.connect(this.master); s.start(now, Math.random() * 2, 0.2);
  }
  tone(freq, at, dur, vol) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(); o.type = "sine"; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(vol, at + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(this.master); o.start(at); o.stop(at + dur + 0.05);
  }
  // kind: "arrive" (two rising notes), "warn" (one note), "bad" (two falling notes; at most one every 2.5 s)
  alert(kind) {
    const ctx = this.ctx; if (!ctx || !this.on || ctx.state !== "running") return;
    const t = ctx.currentTime;
    if (kind === "bad") { if (t - this.lastAlarm < 2.5) return; this.lastAlarm = t; this.tone(880, t, 0.16, 0.05); this.tone(660, t + 0.2, 0.22, 0.05); }
    else if (kind === "warn") this.tone(700, t, 0.25, 0.045);
    else { this.tone(520, t, 0.12, 0.04); this.tone(780, t + 0.13, 0.18, 0.04); }
  }
}
