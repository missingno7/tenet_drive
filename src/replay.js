import { clamp, lerp } from './config.js';
const copyVector = v => ({ x: v.x, y: v.y, z: v.z });
export function copyState(state) {
  return { position: copyVector(state.position), rotation: { ...state.rotation }, linearVelocity: copyVector(state.linearVelocity), angularVelocity: copyVector(state.angularVelocity) };
}
export function slerp(a, b, t) {
  let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const sign = d < 0 ? -1 : 1;
  d = clamp(Math.abs(d), 0, 1);
  const theta = Math.acos(d), sin = Math.sin(theta);
  const wa = sin < 1e-6 ? 1 - t : Math.sin((1 - t) * theta) / sin;
  const wb = (sin < 1e-6 ? t : Math.sin(t * theta) / sin) * sign;
  const q = { x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb, z: a.z * wa + b.z * wb, w: a.w * wa + b.w * wb };
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  for (const k of ['x', 'y', 'z', 'w']) q[k] /= n;
  return q;
}
export function interpolateState(a, b, t) {
  const vector = (x, y) => ({ x: lerp(x.x, y.x, t), y: lerp(x.y, y.y, t), z: lerp(x.z, y.z, t) });
  return { position: vector(a.position, b.position), rotation: slerp(a.rotation, b.rotation, t), linearVelocity: vector(a.linearVelocity, b.linearVelocity), angularVelocity: vector(a.angularVelocity, b.angularVelocity) };
}
export class ReplayRecorder {
  constructor(dt) { this.dt = dt; this.frames = []; }
  record(state) { this.frames.push({ time: this.frames.length * this.dt, ...copyState(state) }); }
  finalize() { return new TemporalReplay(this.frames); }
}
export class TemporalReplay {
  constructor(frames) {
    if (frames.length < 2) throw new Error('A replay needs at least two states');
    this.frames = Object.freeze(frames.map(f => {
      const state = copyState(f);
      for (const value of Object.values(state)) Object.freeze(value);
      return Object.freeze({ time: f.time, ...state });
    }));
    this.duration = this.frames.at(-1).time;
    Object.freeze(this);
  }
  sample(time) {
    const t = clamp(time, 0, this.duration);
    let lo = 0, hi = this.frames.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.frames[mid].time <= t) lo = mid; else hi = mid; }
    const a = this.frames[lo], b = this.frames[hi];
    return interpolateState(a, b, clamp((t - a.time) / (b.time - a.time), 0, 1));
  }
}
/** Read-only kinematic body: callers receive a copy, never a reference into history. */
export class TemporalEcho {
  constructor(replay) { this.replay = replay; }
  sample(elapsed) {
    if (elapsed > this.replay.duration + 1e-8) return null;
    const state = this.replay.sample(this.replay.duration - elapsed);
    for (const k of ['x', 'y', 'z']) { state.linearVelocity[k] *= -1; state.angularVelocity[k] *= -1; }
    return state;
  }
}
