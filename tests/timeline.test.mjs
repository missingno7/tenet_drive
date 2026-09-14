import test from 'node:test';
import assert from 'node:assert/strict';
import { PHYSICS, angleDelta, clamp } from '../src/config.js';
import { TrackManager } from '../src/track.js';
import { RunManager } from '../src/run.js';
import { ReplayRecorder, TemporalEcho, copyState } from '../src/replay.js';
import { EchoClock } from '../src/echo-clock.js';
import { rotationFromAngles, rotateVector } from '../src/vehicle.js';

const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const magnitude = v => Math.hypot(v.x, v.y, v.z);
function fixture(t) { const run = new RunManager(new TrackManager()); run.start(); t.after(() => run.physics.dispose()); return run; }
function until(run, status, limit = 2000) {
  for (let i = 0; i < limit && run.status !== status; i++) run.step(idle);
  assert.equal(run.status, status);
}
function drive(run) {
  const p = run.player, track = run.track;
  const z = clamp(p.position.z + run.direction * (7 + p.speed * .38), track.a, track.b);
  const x = track.center(z) - track.branchOffset(z), yaw = Math.atan2(x - p.position.x, z - p.position.z);
  return { throttle: p.speed < 25 ? 1 : 0, brake: p.speed > 27 ? .6 : 0, steer: clamp(angleDelta(p.yaw, yaw) * 2.2, -1, 1), handbrake: false };
}

test('finish momentum is redirected into both next runs, recorded at t=0, and retained on retry', t => {
  const run = fixture(t);
  for (const direction of [1, -1]) {
    run.direction = direction; run.restart();
    const z = (direction > 0 ? run.track.b : run.track.a) - direction * .1;
    run.checkpoints.next = run.checkpoints.targets.length;
    run.physics.teleport(run.player, { x: run.track.center(z), y: 12.68, z }, rotationFromAngles(direction > 0 ? 0 : Math.PI), { x: 0, y: 0, z: direction * 200 / 3.6 });
    run.step(idle); assert.equal(run.status, 'transition');
    const finish = run.history.frames.at(-1), speed = magnitude(finish.linearVelocity), history = run.history;
    run.advance(); assert.equal(run.direction, -direction);
    assert.ok(Math.abs(run.player.speed - speed) < .001);
    assert.ok(run.player.linearVelocity.z * direction < 0);
    const forward = rotateVector({ x: 0, y: 0, z: 1 }, run.player.rotation);
    assert.ok(forward.z * direction < -.99);
    assert.ok(Math.abs(magnitude(run.recorder.frames[0].linearVelocity) - speed) < .001);
    assert.deepEqual(run.echoState.position, finish.position);
    assert.ok(Math.abs(magnitude(run.echoState.linearVelocity) - speed) < .001);
    run.restart(); assert.equal(run.history, history); assert.ok(Math.abs(run.player.speed - speed) < .001);
  }
  run.newTimeline(); assert.equal(run.direction, 1); assert.equal(run.runNumber, 1); assert.equal(run.history, null); assert.equal(run.player.speed, 0);
});

test('half-course crash + Continue starts opposite run with a solid waiting wreck, then reverses on approach', t => {
  const run = fixture(t), wallZ = 305, lane = run.track.lanes(wallZ)[0];
  run.physics.addBox(4, 2, .4, lane.center, 13, wallZ, 'wall');
  let steps = 0;
  while (run.status === 'playing' && steps++ < 120 * 40) run.step(drive(run));
  assert.equal(run.status, 'crashing');
  assert.ok(run.player.position.z > 290 && run.player.position.z < 310, 'Drive from A to the halfway wall');
  until(run, 'decision');
  const event = run.recorder.events[0], wreck = copyState(run.player), frames = run.recorder.frames.length;
  assert.equal(event.type, 'MajorCrash'); assert.ok(event.severity > 18);
  assert.ok(event.endTime - event.time >= 2); assert.ok(wreck.detachedParts.length > 0);
  for (let i = 0; i < 120; i++) run.step(idle);
  assert.deepEqual(copyState(run.player), wreck); assert.equal(run.recorder.frames.length, frames);
  assert.equal(run.history, null, 'The choice has not committed history yet');
  run.continueRun();
  assert.equal(run.status, 'playing'); assert.equal(run.direction, -1); assert.equal(run.runNumber, 2);
  assert.equal(run.player.position.z, run.track.b); assert.equal(run.elapsed, 0);
  assert.equal(run.player.speed, 0, 'Only successful finish momentum carries over');
  assert.equal(run.history.endedBy, 'crash'); assert.equal(run.history.frames.length, frames);
  assert.deepEqual(run.history.frames.at(-1).position, wreck.position);
  assert.deepEqual(run.echoState.position, wreck.position); assert.deepEqual(run.echoState.rotation, wreck.rotation);
  assert.deepEqual(run.echoState.detachedParts, wreck.detachedParts);
  assert.equal(run.echoClock.phase, 'WaitingAtFinalState');
  assert.equal(magnitude(run.echoState.linearVelocity), 0);
  const history = run.history, serialized = JSON.stringify(history);
  for (let i = 0; i < 120; i++) run.step(idle);
  assert.equal(run.echoElapsed, 0); assert.deepEqual(run.echoState.position, wreck.position);
  assert.ok(magnitude(run.physics.echoBody.linvel()) < 1e-5);
  // The waiting wreck is already an obstacle. Keep activation disabled for this isolated contact check.
  run.echoClock.activationDistance = 0;
  let hit = false;
  for (let i = 0; i < 30; i++) {
    run.physics.teleport(run.player, { ...wreck.position, x: wreck.position.x + 1.5 }, wreck.rotation, { x: -40, y: 0, z: 0 });
    const result = run.physics.step(run.player, idle, PHYSICS.dt, run.echoClock.sample(), false);
    hit ||= result.contacts.has('echo');
    assert.ok(Math.hypot(...['x','y','z'].map(k => run.physics.echoBody.translation()[k] - wreck.position[k])) < .0001);
  }
  assert.ok(hit); assert.equal(run.echoClock.phase, 'WaitingAtFinalState');
  // Restart the new B→A attempt, retaining the same crashed history and waiting state.
  run.restart(); assert.equal(run.history, history);
  steps = 0;
  while (run.echoClock.phase === 'WaitingAtFinalState' && run.status === 'playing' && steps++ < 120 * 40) run.step(drive(run));
  assert.equal(run.status, 'playing', run.notice); assert.equal(run.echoClock.phase, 'ReversePlayback');
  const p=run.player.position;
  assert.ok(Math.hypot(p.x-wreck.position.x,p.y-wreck.position.y,p.z-wreck.position.z) < 61);
  assert.ok(run.echoElapsed < .02, 'Playback starts at the last frame, not at elapsed driving time');
  // Traverse every recorded crash pose in reverse while applying repeated contacts from the live car.
  const echo = new TemporalEcho(history); hit = false;
  for (let reverseTime = 0; reverseTime < history.duration - event.time + .15; reverseTime += PHYSICS.dt) {
    const state=echo.sample(reverseTime), original=history.sample(history.duration-reverseTime);
    assert.deepEqual(state.position, original.position); assert.deepEqual(state.rotation, original.rotation);
    run.physics.teleport(run.player, { ...state.position, x: state.position.x + 1.5 }, state.rotation, { x: -40, y: 0, z: 0 });
    const result=run.physics.step(run.player,idle,PHYSICS.dt,state,false); hit ||= result.contacts.has('echo');
    assert.ok(Math.hypot(...['x','y','z'].map(k=>run.physics.echoBody.translation()[k]-state.position[k])) < .0001);
  }
  assert.ok(hit); assert.equal(JSON.stringify(history),serialized);
  assert.throws(()=>{history.events[0].position.x=999;},TypeError);
  assert.throws(()=>{history.frames.at(-1).detachedParts.push('fake');},TypeError);
  // Once activated, retreating cannot reset or retrigger history.
  while (run.echoClock.phase !== 'Finished') run.echoClock.step(.1, { position: {x:999,y:999,z:999} });
  assert.equal(run.echoClock.sample(),null);
  assert.deepEqual(echo.sample(history.duration).position,history.frames[0].position);
});

test('Continue also inverts a crashed B→A attempt into A→B without a recovery path', t => {
  const run=fixture(t);run.direction=-1;run.restart();
  run.physics.teleport(run.player,{x:55,y:30,z:280},rotationFromAngles(Math.PI),{x:0,y:-45,z:0});
  until(run,'decision');const wreck=copyState(run.player),count=run.recorder.frames.length;
  run.continueRun();assert.equal(run.direction,1);assert.equal(run.player.position.z,run.track.a);
  assert.equal(run.history.frames.length,count);assert.deepEqual(run.echoState.position,wreck.position);
  assert.equal(run.echoClock.phase,'WaitingAtFinalState');assert.equal(run.recorder.frames.length,1);
  run.continueRun();assert.equal(run.runNumber,2,'Continue only acts on the choice screen');
});

test('Restart discards the crash, retains prior history, and does not invert', t => {
  const run=fixture(t),recorder=new ReplayRecorder(PHYSICS.dt);
  recorder.record(run.player);recorder.record(run.player);run.history=recorder.finalize();
  const history=run.history;run.restart();run.fail('OUT OF BOUNDS');until(run,'decision');
  run.restart();assert.equal(run.direction,1);assert.equal(run.runNumber,1);assert.equal(run.history,history);
  assert.equal(run.status,'playing');assert.equal(run.recorder.events.length,0);assert.equal(run.recorder.frames.length,1);
});

function shortReplay(endedBy) {
  const recorder=new ReplayRecorder(.1);
  for(let i=0;i<=20;i++)recorder.record({position:{x:0,y:12,z:i*5},rotation:rotationFromAngles(i/20),linearVelocity:{x:0,y:0,z:50},angularVelocity:{x:0,y:1,z:0},detachedParts:i>15?['hood']:[]});
  return recorder.finalize({endedBy});
}

test('waiting wrecks remain frozen indefinitely, use 3D activation distance, and render sampling is read-only', () => {
  const replay=shortReplay('crash'),clock=new EchoClock(replay,{activationDistance:30}),far={position:{x:0,y:100,z:100}};
  for(let i=0;i<3000;i++){const state=clock.step(.1,far);assert.deepEqual(state.position,replay.frames.at(-1).position);assert.equal(magnitude(state.linearVelocity),0);assert.equal(magnitude(state.angularVelocity),0);}
  assert.equal(clock.elapsed,0);assert.equal(clock.phase,'WaitingAtFinalState');
  for(let i=0;i<100;i++)clock.sample();assert.equal(clock.phase,'WaitingAtFinalState');
  clock.step(.1,{position:{x:0,y:12,z:71}});assert.equal(clock.phase,'ReversePlayback');assert.equal(clock.elapsed,0);
  clock.step(.1,far);assert.ok(Math.abs(clock.elapsed-.1)<1e-9);
  assert.deepEqual(clock.sample().position,replay.sample(replay.duration-.1).position);
  assert.deepEqual(clock.sample(1).detachedParts,[]);
});

test('successful histories start immediately and pause freezes both simulation and replay', t => {
  const replay=shortReplay('finish'),clock=new EchoClock(replay);
  assert.equal(clock.phase,'ReversePlayback');clock.step(.1,{position:{x:999,y:0,z:999}});assert.equal(clock.elapsed,.1);
  const run=fixture(t);run.history=replay;run.restart();run.step(idle);
  const time=run.elapsed,echoTime=run.echoElapsed,count=run.recorder.frames.length,state=copyState(run.player);
  run.paused=true;for(let i=0;i<120;i++)run.step(idle);
  assert.equal(run.elapsed,time);assert.equal(run.echoElapsed,echoTime);assert.equal(run.recorder.frames.length,count);assert.deepEqual(copyState(run.player),state);
});
