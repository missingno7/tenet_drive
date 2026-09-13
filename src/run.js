import { PHYSICS, RUN, VEHICLE, clamp } from './config.js';
import { VehicleController } from './vehicle.js';
import { ReplayRecorder, TemporalEcho, copyState } from './replay.js';
import { contactBetween } from './collision.js';
import { PhysicsWorld } from './physics.js';
import { WATER_LEVEL } from './surfaces.js';
import { ScoringSystem } from './scoring.js';
import { CheckpointSystem } from './track.js';

export class RunManager {
  constructor(track) {
    this.track = track; this.history = null; this.echo = null;
    this.runNumber = 1; this.direction = 1; this.status = 'intro'; this.paused = false;
    this.physics = new PhysicsWorld(track); this.notice = null; this.lastResult = null; this.crashSerial = 0;
    this.resetAttempt();
  }
  resetAttempt() {
    const z = this.direction > 0 ? this.track.a : this.track.b;
    let x = this.track.center(z) - this.direction * 2.8;
    if (this.history) {
      const last = this.history.frames.at(-1).position;
      const c = this.track.center(z), extent = this.track.width(z) / 2 - VEHICLE.halfWidth - 0.4;
      const candidates = [clamp(last.x - 3.5, c - extent, c + extent), clamp(last.x + 3.5, c - extent, c + extent)];
      x = candidates.sort((a, b) => Math.abs(b - last.x) - Math.abs(a - last.x))[0];
    }
    this.player = new VehicleController(x, z, this.track.heading(z, this.direction), this.track);
    this.echo = this.history ? new TemporalEcho(this.history) : null;
    this.echoState = this.echo?.sample(0) ?? null;
    this.physics.reset(this.player, this.echoState);
    this.previousPlayer = copyState(this.player);
    this.recorder = new ReplayRecorder(PHYSICS.dt); this.recorder.record(this.player);
    this.scoring = new ScoringSystem(); this.checkpoints = new CheckpointSystem(this.track, this.direction);
    this.ticks = 0; this.elapsed = 0; this.stuckTime = 0; this.transitionTime = 0; this.impact = 0; this.notice = null;
    this.crash = null; this.effect = null; this.rolloverTime = 0; this.submergedTime = 0; this.wasWet = false;
  }
  start() { this.status = 'playing'; this.paused = false; }
  restart() {
    if (this.status === 'transition') { this.advance(); return; }
    this.resetAttempt(); this.status = 'playing'; this.paused = false;
    this.notice = this.history ? 'RETRY / HISTORY PRESERVED' : 'NEW ATTEMPT';
  }
  newTimeline() { this.history = null; this.direction = 1; this.runNumber = 1; this.lastResult = null; this.restart(); }
  advance() { this.direction *= -1; this.runNumber++; this.resetAttempt(); this.status = 'playing'; this.notice = 'DIRECTION REVERSED / WATCH YOUR PREVIOUS SELF'; }
  fail(reason) { this.status = 'failed'; this.transitionTime = RUN.failureSeconds; this.notice = reason + ' / RETRYING'; }
  impactEffect(kind, impact, position = this.player.position) {
    this.effect = { id: ++this.crashSerial, kind, impact, age: 0, position: { ...position } };
    if (kind === 'water') this.effect.position.y = WATER_LEVEL;
  }
  crashAt(kind, impact, position = this.player.position) {
    this.impactEffect(kind, impact, position); this.crash = this.effect;
    this.status = 'failed'; this.transitionTime = 2.2;
    this.notice = kind === 'water' ? 'ENGINE SUBMERGED' : 'VEHICLE WRECKED';
  }
  finish() {
    this.lastResult = { time: this.elapsed, score: Math.floor(this.scoring.score), bestGap: this.scoring.bestGap, maxMultiplier: this.scoring.maxMultiplier, direction: this.direction, runNumber: this.runNumber };
    this.history = this.recorder.finalize(); this.status = 'transition'; this.transitionTime = RUN.transitionSeconds;
    this.notice = 'TIMELINE SEALED';
  }
  step(input) {
    const dt = PHYSICS.dt;
    if (this.paused || this.status === 'intro') return;
    if (this.effect) { this.effect.age += dt; if (this.effect.age > 2.2) this.effect = null; }
    if (this.status === 'transition' || this.status === 'failed') {
      if (this.crash) {
        for (let i = 0; i < PHYSICS.substeps; i++) {
          this.physics.step(this.player, input, dt / PHYSICS.substeps, this.echoState, false);
        }
      }
      this.transitionTime -= dt;
      if (this.transitionTime <= 0) { if (this.status === 'transition') this.advance(); else this.restart(); }
      return;
    }
    this.previousPlayer = copyState(this.player);
    const previousZ = this.player.position.z;
    const subDt = dt / PHYSICS.substeps;
    this.impact *= 0.93;
    for (let i = 1; i <= PHYSICS.substeps; i++) {
      // Evaluate immutable history at each contact step, while recording once
      // at the fixed 120 Hz boundary. No render timing enters the simulation.
      this.echoState = this.echo?.sample((this.ticks * PHYSICS.substeps + i) * subDt) ?? null;
      const fallSpeed = Math.max(0, -this.player.linearVelocity.y);
      const result = this.physics.step(this.player, input, subDt, this.echoState);
      const contact = this.echoState ? contactBetween(this.player, this.echoState) : null;
      if (contact && result.contacts.has('echo')) contact.colliding = true;
      this.impact = Math.max(this.impact, result.impact);
      this.scoring.step(subDt, this.player, this.echoState, contact);
      if (this.scoring.event) this.notice = this.scoring.event;
      else if (result.impact > 5) this.notice = result.contacts.has('echo') ? 'HISTORY DOES NOT YIELD' : 'HARD CONTACT';
      if (result.water && !this.wasWet) this.impactEffect('water', fallSpeed);
      this.wasWet = result.water;
      this.submergedTime = result.submerged > 0.65 ? this.submergedTime + subDt : 0;
      if (this.submergedTime > 0.8) { this.crashAt('water', fallSpeed); return; }
      if (result.impact > 18) { this.crashAt('terrain', result.impact, result.point); return; }
    }
    this.ticks++; this.elapsed = this.ticks * dt;
    this.recorder.record(this.player);
    const supported = this.track.sample(this.player.position.x, this.player.position.z);
    this.checkpoints.update(previousZ, this.player.position.z, !!supported && this.player.position.y >= 11);
    this.stuckTime = this.player.speed < 0.8 && this.elapsed > 2 ? this.stuckTime + dt : 0;
    const p = this.player.position;
    this.rolloverTime = this.player.upright < 0.2 && this.player.speed < 3 ? this.rolloverTime + dt : 0;
    if (this.rolloverTime > 2) { this.crashAt('terrain', 8); return; }
    if (p.y < -70 || Math.abs(p.x) > 450 || p.z < -250 || p.z > 900) { this.fail('OUT OF BOUNDS'); return; }
    if (this.stuckTime > RUN.stuckSeconds || this.elapsed > RUN.maxTime) { this.fail('TIME LOST'); return; }
    const destination = this.direction > 0 ? this.track.b : this.track.a;
    if ((p.z - destination) * this.direction >= 0 && supported && p.y < supported.height + 3 && this.checkpoints.complete) this.finish();
  }
  get progress() { return clamp((this.player.position.z - this.track.a) / (this.track.b - this.track.a), 0, 1); }
}
