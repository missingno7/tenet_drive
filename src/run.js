import { PHYSICS, RUN, VEHICLE, clamp } from './config.js';
import { VehicleController, rotateVector } from './vehicle.js';
import { ReplayRecorder, copyState } from './replay.js';
import { EchoClock } from './echo-clock.js';
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
    if (this.history && this.history.endedBy !== 'crash') {
      const last = this.history.frames.at(-1).position;
      const c = this.track.center(z), extent = this.track.width(z) / 2 - VEHICLE.halfWidth - 0.4;
      const candidates = [clamp(last.x - 3.5, c - extent, c + extent), clamp(last.x + 3.5, c - extent, c + extent)];
      x = candidates.sort((a, b) => Math.abs(b - last.x) - Math.abs(a - last.x))[0];
    }
    this.player = new VehicleController(x, z, this.track.heading(z, this.direction), this.track);
    const incoming = this.history?.endedBy !== 'crash' ? this.history?.frames.at(-1).linearVelocity : null;
    this.launchSpeed = incoming ? Math.hypot(incoming.x, incoming.y, incoming.z) : 0;
    const forward = rotateVector({ x: 0, y: 0, z: 1 }, this.player.rotation);
    this.player.linearVelocity = { x: forward.x * this.launchSpeed, y: forward.y * this.launchSpeed, z: forward.z * this.launchSpeed };
    this.echoClock = this.history ? new EchoClock(this.history) : null;
    this.echo = this.echoClock?.echo ?? null; this.previousEchoElapsed = 0;
    this.echoState = this.echoClock?.sample() ?? null;
    this.physics.reset(this.player, this.echoState);
    this.previousPlayer = copyState(this.player);
    this.recorder = new ReplayRecorder(PHYSICS.dt); this.recorder.record(this.player);
    this.scoring = new ScoringSystem(); this.checkpoints = new CheckpointSystem(this.track, this.direction);
    this.ticks = 0; this.elapsed = 0; this.stuckTime = 0; this.transitionTime = 0; this.impact = 0; this.notice = null;
    this.crash = null; this.effect = null; this.rolloverTime = 0; this.submergedTime = 0; this.wasWet = false;
    this.crashTime = 0; this.settledTime = 0; this.currentEvent = null; this.drivingTime = 0;
  }
  start() { if (this.status === 'intro') { this.status = 'playing'; this.paused = false; } }
  restart() {
    if (this.status === 'transition') { this.advance(); return; }
    this.resetAttempt(); this.status = 'playing'; this.paused = false;
    this.notice = this.history ? 'RETRY / HISTORY PRESERVED' : 'NEW ATTEMPT';
  }
  newTimeline() { this.history = null; this.direction = 1; this.runNumber = 1; this.lastResult = null; this.status = 'playing'; this.restart(); }
  advance() {
    if (this.status !== 'transition') return;
    this.direction *= -1; this.runNumber++; this.resetAttempt(); this.status = 'playing';
    this.notice = `INVERTED / ${Math.round(this.launchSpeed * 3.6)} KM/H`;
  }
  fail(reason) { this.crashAt('terrain', 0, this.player.position, reason); }
  impactEffect(kind, impact, position = this.player.position) {
    this.effect = { id: ++this.crashSerial, kind, impact, age: 0, position: { ...position } };
    if (kind === 'water') this.effect.position.y = WATER_LEVEL;
  }
  crashAt(kind, impact, position = this.player.position, reason = null, time = this.elapsed) {
    if (this.status !== 'playing') return;
    this.impactEffect(kind, impact, position); this.crash = this.effect;
    this.status = 'crashing'; this.crashTime = 0;
    this.notice = reason ?? (kind === 'water' ? 'ENGINE SUBMERGED' : 'VEHICLE WRECKED');
    this.currentEvent = { type: impact > 0 ? 'MajorCrash' : 'Stopped', kind, reason: this.notice, severity: impact, time, position: { ...position } };
    this.recorder.events.push(this.currentEvent);
    this.scoring.sustain = 0; this.scoring.multiplier = 0;
  }
  continueRun() {
    if (this.status !== 'decision') return;
    this.finish('crash'); this.advance(); this.paused = false;
    this.notice = 'INVERTED / YOUR WRECK IS WAITING';
  }
  finish(endedBy = 'finish') {
    this.lastResult = { time: this.elapsed, score: Math.floor(this.scoring.score), bestGap: this.scoring.bestGap, maxMultiplier: this.scoring.maxMultiplier, direction: this.direction, runNumber: this.runNumber };
    this.history = this.recorder.finalize({ endedBy }); this.status = 'transition'; this.transitionTime = RUN.transitionSeconds;
    this.notice = 'TIMELINE SEALED / INVERTING';
  }
  get timelineActive() { return !this.paused && ['playing', 'crashing'].includes(this.status); }
  get echoElapsed() { return this.echoClock?.elapsed ?? 0; }
  sampleEcho(alpha = 1) {
    const time = this.timelineActive ? this.previousEchoElapsed + (this.echoElapsed - this.previousEchoElapsed) * alpha : this.echoElapsed;
    return this.echoClock?.sample(time) ?? null;
  }
  step(input) {
    const dt = PHYSICS.dt;
    if (this.paused || this.status === 'intro' || this.status === 'decision') return;
    if (this.effect) { this.effect.age += dt; if (this.effect.age > 2.2) this.effect = null; }
    if (this.status === 'transition') {
      this.transitionTime -= dt; if (this.transitionTime <= 0) this.advance(); return;
    }
    this.previousPlayer = copyState(this.player); this.previousEchoElapsed = this.echoElapsed;
    const previousZ = this.player.position.z;
    const subDt = dt / PHYSICS.substeps;
    this.impact *= 0.93;
    for (let i = 1; i <= PHYSICS.substeps; i++) {
      const controls = this.status === 'playing';
      this.echoState = this.echoClock?.step(subDt, this.player) ?? null;
      const fallSpeed = Math.max(0, -this.player.linearVelocity.y);
      const result = this.physics.step(this.player, input, subDt, this.echoState, controls);
      this.impact = Math.max(this.impact, result.impact);
      if (!controls) continue;
      const contact = this.echoState ? contactBetween(this.player, this.echoState) : null;
      if (contact && result.contacts.has('echo')) contact.colliding = true;
      this.scoring.step(subDt, this.player, this.echoState, contact);
      if (this.scoring.event) this.notice = this.scoring.event;
      else if (result.impact > 5) this.notice = result.contacts.has('echo') ? 'HISTORY DOES NOT YIELD' : 'HARD CONTACT';
      if (result.water && !this.wasWet) this.impactEffect('water', fallSpeed);
      this.wasWet = result.water;
      this.submergedTime = result.submerged > 0.65 ? this.submergedTime + subDt : 0;
      if (this.submergedTime > 0.8) this.crashAt('water', Math.max(1, fallSpeed), this.player.position, null, (this.ticks + 1) * dt);
      else if (result.impact > 18) this.crashAt('terrain', result.impact, result.point, null, (this.ticks + 1) * dt);
    }
    this.ticks++; this.elapsed = this.ticks * dt;
    this.recorder.record(this.player);
    if (this.status === 'crashing') {
      this.crashTime += dt;
      const v = this.player.linearVelocity, w = this.player.angularVelocity;
      this.settledTime = Math.hypot(v.x, v.y, v.z) < .7 && Math.hypot(w.x, w.y, w.z) < .6 ? this.settledTime + dt : 0;
      if (this.crashTime >= RUN.crashMaxSeconds || (this.crashTime >= RUN.crashSeconds && this.settledTime > .35)) {
        this.status = 'decision'; this.currentEvent.endTime = this.elapsed;
        this.currentEvent.wreckPosition = { ...this.player.position };
      }
      return;
    }
    const supported = this.track.sample(this.player.position.x, this.player.position.z);
    this.checkpoints.update(previousZ, this.player.position.z, !!supported && this.player.position.y >= 11);
    this.drivingTime += dt;
    this.stuckTime = this.player.speed < 0.8 && this.drivingTime > 2 ? this.stuckTime + dt : 0;
    const p = this.player.position;
    this.rolloverTime = this.player.upright < 0.2 && this.player.speed < 3 ? this.rolloverTime + dt : 0;
    if (this.rolloverTime > 2) { this.crashAt('terrain', 8); return; }
    if (p.y < -70 || Math.abs(p.x) > 450 || p.z < -250 || p.z > 900) { this.fail('OUT OF BOUNDS'); return; }
    if (this.stuckTime > RUN.stuckSeconds || this.drivingTime > RUN.maxTime) { this.fail('TIME LOST'); return; }
    const destination = this.direction > 0 ? this.track.b : this.track.a;
    if ((p.z - destination) * this.direction >= 0 && supported && p.y < supported.height + 3 && this.checkpoints.complete) this.finish();
  }
  get progress() { return clamp((this.player.position.z - this.track.a) / (this.track.b - this.track.a), 0, 1); }
}
