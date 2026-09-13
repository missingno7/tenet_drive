import { reverseEngineSamples, impactSamples } from './audio-synthesis.js';
import { clamp } from './config.js';
export class GameAudio {
  constructor() { this.enabled = false; this.context = null; this.lastImpact = -1; this.lastCrash = 0; this.voices = new Set(); }
  buffer(samples) { const b = this.context.createBuffer(1, samples.length, 22050); b.copyToChannel(samples, 0); return b; }
  stopEcho() { if (this.echoSource) { this.echoSource.stop(); this.echoSource.disconnect(); this.echoSource = null; } }
  stopVoices() { for (const voice of this.voices) voice.stop(); this.voices.clear(); }
  async toggle() {
    this.enabled = !this.enabled;
    if (this.enabled && !this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) { this.enabled = false; return false; }
      this.context = new Context(); this.master = this.context.createGain(); this.master.gain.value = 0.22; this.master.connect(this.context.destination);
      this.engine = this.context.createOscillator(); this.engine.type = 'sawtooth'; this.engine.frequency.value = 40;
      this.filter = this.context.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 230;
      this.engineGain = this.context.createGain(); this.engineGain.gain.value = 0;
      this.engine.connect(this.filter); this.filter.connect(this.engineGain); this.engineGain.connect(this.master); this.engine.start();
      this.echoGain = this.context.createGain(); this.echoGain.gain.value = 0; this.echoPan = this.context.createStereoPanner(); this.echoGain.connect(this.echoPan); this.echoPan.connect(this.master);
      this.impactBuffers = { water: this.buffer(impactSamples('water')), terrain: this.buffer(impactSamples('terrain')) };
    }
    if (this.context) { await this.context.resume(); this.master.gain.setTargetAtTime(this.enabled ? 0.22 : 0, this.context.currentTime, 0.04); }
    if (!this.enabled) { this.stopEcho(); this.stopVoices(); }
    return this.enabled;
  }
  playImpact(kind, volume) {
    const source = this.context.createBufferSource(), gain = this.context.createGain(); source.buffer = this.impactBuffers[kind]; gain.gain.value = volume;
    source.connect(gain); gain.connect(this.master); this.voices.add(source); source.start();
    source.onended = () => { this.voices.delete(source); source.disconnect(); gain.disconnect(); };
  }
  update(run) {
    if (!this.context || !this.enabled) return;
    const t = this.context.currentTime, active = run.status === 'playing' && !run.paused;
    this.engine.frequency.setTargetAtTime(35 + run.player.speed * 3.2, t, 0.12);
    this.filter.frequency.setTargetAtTime(160 + run.player.speed * 14, t, 0.1);
    this.engineGain.gain.setTargetAtTime(active ? 0.14 : 0, t, 0.04);
    const replay = run.echo?.replay;
    if (active && replay && run.echoState) {
      if (this.echoReplay !== replay) { this.stopEcho(); this.echoReplay = replay; this.echoBuffer = this.buffer(reverseEngineSamples(replay)); }
      // Restart at the current reverse-playback time on retries and resumes.
      if (this.echoSource && run.elapsed < this.lastElapsed) this.stopEcho();
      if (!this.echoSource && run.elapsed < this.echoBuffer.duration) {
        this.echoSource = this.context.createBufferSource(); this.echoSource.buffer = this.echoBuffer; this.echoSource.connect(this.echoGain); this.echoSource.start(0, run.elapsed);
      }
      const dx = run.echoState.position.x - run.player.position.x, dz = run.echoState.position.z - run.player.position.z;
      const distance = Math.hypot(dx, dz, run.echoState.position.y - run.player.position.y);
      this.echoGain.gain.setTargetAtTime(0.7 * (1 - clamp(distance / 75, 0, 1)) ** 2, t, 0.05);
      this.echoPan.pan.setTargetAtTime(clamp((-dx * Math.cos(run.player.yaw) + dz * Math.sin(run.player.yaw)) / 15, -1, 1), t, 0.05);
    } else this.stopEcho();
    this.lastElapsed = run.elapsed;
    if (run.paused) { this.stopVoices(); return; }
    if (run.effect && run.effect.id !== this.lastCrash) {
      this.lastCrash = run.effect.id;
      if (run.effect.age < 0.7) this.playImpact(run.effect.kind, 1.2);
    } else if (active && run.impact > 5 && t - this.lastImpact > 0.35) {
      this.lastImpact = t; this.playImpact('terrain', clamp(run.impact / 30, 0.12, 0.7));
    }
  }
}
