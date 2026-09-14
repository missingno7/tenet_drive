import { TEMPORAL } from './config.js';
import { TemporalEcho } from './replay.js';

/** A prematurely ended timeline waits at its last recorded pose until approached. */
export class EchoClock {
  constructor(replay, { activationDistance = TEMPORAL.activationDistance } = {}) {
    this.echo = new TemporalEcho(replay); this.elapsed = 0;
    this.activationDistance = activationDistance;
    this.phase = replay.endedBy === 'crash' ? 'WaitingAtFinalState' : 'ReversePlayback';
  }
  step(dt, player) {
    if (this.phase === 'Finished') return null;
    if (this.phase === 'WaitingAtFinalState') {
      const wreck = this.echo.replay.frames.at(-1).position, p = player.position;
      if (Math.hypot(p.x - wreck.x, p.y - wreck.y, p.z - wreck.z) < this.activationDistance) this.phase = 'ReversePlayback';
      return this.sample();
    }
    this.elapsed += dt;
    if (this.elapsed > this.echo.replay.duration + 1e-8) this.phase = 'Finished';
    return this.sample();
  }
  sample(time = this.elapsed) {
    if (this.phase === 'Finished') return null;
    const state = this.echo.sample(time);
    if (state && this.phase === 'WaitingAtFinalState') {
      state.frozen = true;
      state.linearVelocity = { x: 0, y: 0, z: 0 }; state.angularVelocity = { x: 0, y: 0, z: 0 };
    }
    return state;
  }
}
