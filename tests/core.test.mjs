import test from 'node:test';
import assert from 'node:assert/strict';
import { PHYSICS, VEHICLE, angleDelta, clamp } from '../src/config.js';
import { TrackManager } from '../src/track.js';
import { ReplayRecorder, TemporalEcho, copyState } from '../src/replay.js';
import { VehicleController, rotationFromAngles } from '../src/vehicle.js';
import { contactBetween } from '../src/collision.js';
import { ScoringSystem } from '../src/scoring.js';
import { RunManager } from '../src/run.js';
import * as THREE from 'three';
import { DECK_THICKNESS, roadSlabGeometry, signPanel } from '../src/world-geometry.js';

const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const state = (x, z, yaw = 0, y = 12.68) => ({ position: { x, y, z }, rotation: rotationFromAngles(yaw), linearVelocity: { x: 0, y: 0, z: 20 }, angularVelocity: { x: 0, y: 0, z: 0 } });
function makeReplay() {
  const recorder = new ReplayRecorder(0.1);
  for (let i = 0; i <= 100; i++) recorder.record(state(Math.sin(i / 10), i * 2, i / 30));
  return recorder.finalize();
}

test('authoritative state copy, interpolation and exact reverse endpoints', () => {
  const replay = makeReplay(), echo = new TemporalEcho(replay);
  assert.deepEqual(replay.sample(0).position, replay.frames[0].position);
  assert.deepEqual(echo.sample(0).position, replay.frames.at(-1).position);
  assert.deepEqual(echo.sample(replay.duration).position, replay.frames[0].position);
  assert.equal(echo.sample(replay.duration + 0.01), null);
  for (const t of [0.05, 1.27, 4.31, 8.955]) {
    assert.deepEqual(echo.sample(t).position, replay.sample(replay.duration - t).position);
    assert.equal(echo.sample(t).linearVelocity.z, -20);
    const q = echo.sample(t).rotation;
    assert.ok(Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-5);
  }
  const sample = echo.sample(2); sample.position.x = 999;
  assert.notEqual(echo.sample(2).position.x, 999);
  assert.throws(() => { replay.frames[0].position.x = 100; }, TypeError);
});

test('replay samples do not depend on render cadence', () => {
  const replay = makeReplay(), echo = new TemporalEcho(replay);
  const reference = echo.sample(4.2);
  for (const fps of [30, 60, 144]) {
    for (let frame = 0; frame < fps * 4; frame++) echo.sample(frame / fps);
    assert.deepEqual(echo.sample(4.2), reference);
  }
});

test('clearance uses body surfaces and honors vertical separation', () => {
  const a = state(0, 0), b = state(VEHICLE.halfWidth * 2 + 0.42, 0);
  assert.ok(Math.abs(contactBetween(a, b).gap - 0.42) < 1e-5);
  const above = state(0, 0, 0, a.position.y + VEHICLE.halfHeight * 2 + 1.3);
  assert.equal(contactBetween(a, above).colliding, false);
  assert.ok(Math.abs(contactBetween(a, above).gap - 1.3) < 1e-5);
  assert.equal(contactBetween(a, state(0, 0, Math.PI / 4)).colliding, true);
});

test('proximity rewards sustained driving and relative speed; contact and parking score zero', () => {
  const player = state(0, 0), echo = state(2.3, 0);
  const contact = contactBetween(player, echo);
  const sustained = new ScoringSystem(), passes = new ScoringSystem();
  for (let i = 0; i < 240; i++) { sustained.step(PHYSICS.dt, player, echo, contact); passes.sustain = 0; passes.step(PHYSICS.dt, player, echo, contact); }
  assert.equal(sustained.multiplier, 8); assert.ok(sustained.score > passes.score * 1.5);
  const fast = new ScoringSystem(); echo.linearVelocity.z = -30;
  fast.step(PHYSICS.dt, player, echo, contact);
  const slow = new ScoringSystem(); echo.linearVelocity.z = 20;
  slow.step(PHYSICS.dt, player, echo, contact); assert.ok(fast.score > slow.score);
  const score = sustained.score; sustained.step(PHYSICS.dt, player, echo, { ...contact, colliding: true });
  assert.equal(sustained.score, score); assert.equal(sustained.multiplier, 0);
  const parked = new ScoringSystem(); player.linearVelocity.z = 0;
  for (let i = 0; i < 200; i++) parked.step(PHYSICS.dt, player, echo, contact);
  assert.equal(parked.score, 0);
});

/** Test driver operates the same throttle and steer interface as the keyboard. */
export function driveInput(run, branch = -1, cruise = 25) {
  const p = run.player, t = run.track, d = run.direction;
  // Let the equally fast echo pull ahead before merging onto the test racing line.
  if (run.echoState && run.elapsed < 1) return { throttle: 0, brake: p.speed > 8 ? 1 : 0, steer: 0, handbrake: false };
  const lookZ = clamp(p.position.z + d * (7 + p.speed * 0.38), t.a, t.b);
  const targetX = t.center(lookZ) + branch * t.branchOffset(lookZ);
  const targetYaw = Math.atan2(targetX - p.position.x, lookZ - p.position.z);
  const error = angleDelta(p.yaw, targetYaw);
  return { throttle: p.speed < cruise ? 1 : 0, brake: p.speed > cruise + 2 ? 0.6 : 0, steer: clamp(error * 2.2, -1, 1), handbrake: false };
}

test('every rendered road quad has support up to its edges, including split seams and tapers', () => {
  const track = new TrackManager();
  for (const segment of track.segments) for (const lane of segment.lanes) {
    for (const t of [0.001, 0.25, 0.5, 0.75, 0.999]) {
      const z = segment.z0 + (segment.z1 - segment.z0) * t;
      const left = lane.left0 + (lane.left1 - lane.left0) * t;
      const right = lane.right0 + (lane.right1 - lane.right0) * t;
      for (const x of [left, left + 0.001, (left + right) / 2, right - 0.001, right]) {
        const support = track.sample(x, z);
        assert.ok(support, `Unsupported rendered deck at ${x}, ${z}`);
        assert.ok(Math.abs(support.height - (segment.y0 + (segment.y1 - segment.y0) * t)) < 1e-5);
      }
    }
  }
  for (const z of [0, 125, 175, 231, 239.5, 252, 280, 345, 355, 364.5, 365, 495.5, 620]) {
    const lanes = track.lanes(z);
    assert.equal(track.sample(lanes[0].left - 0.001, z), null);
    assert.equal(track.sample(lanes.at(-1).right + 0.001, z), null);
    if (lanes.length === 2) assert.equal(track.sample((lanes[0].right + lanes[1].left) / 2, z), null);
  }
  assert.equal(track.sample(track.center(0), -0.01), null, 'No invisible deck beyond the endpoint');
  assert.equal(track.sample(track.center(620), 620.01), null);
});

test('split and merge contain only exposed boundaries, with no duplicate overlapping road strips', () => {
  const track = new TrackManager();
  for (const z of [231, 240, 252, 350, 355, 364]) assert.equal(track.lanes(z).length, 1, `Overlapping branches must merge at ${z}`);
  assert.equal(track.lanes(295).length, 2);
  for (const segment of track.segments) {
    if (segment.lanes.length === 2) {
      assert.ok(segment.lanes[0].right0 <= segment.lanes[1].left0 + 1e-9);
      assert.ok(segment.lanes[0].right1 <= segment.lanes[1].left1 + 1e-9);
    }
  }
});

test('bollard and sign footprints stay outside the entire road, even at overlapping branches', () => {
  const track = new TrackManager();
  assert.ok(track.bollards.some(p => p.z === 252)); // Previously had posts inside the overlapping split.
  for (const prop of [...track.bollards, ...track.signs]) {
    for (let i = 0; i <= 10; i++) {
      const z = clamp(prop.z - prop.halfDepth + i / 10 * prop.halfDepth * 2, 0, track.length);
      for (const lane of track.lanes(z)) {
        assert.ok(prop.x + prop.halfWidth < lane.left || prop.x - prop.halfWidth > lane.right, `Roadside object overlaps the road at ${prop.x}, ${z}`);
      }
    }
  }
});

test('road slabs have visible outward-facing undersides and watertight faces, including ramps', () => {
  const track = new TrackManager(), mat = new THREE.MeshBasicMaterial();
  for (const segment of track.segments) for (const lane of segment.lanes) {
    const geometry = roadSlabGeometry(segment, lane), mesh = new THREE.Mesh(geometry, [mat, mat]);
    const x = (lane.left0 + lane.right0 + lane.left1 + lane.right1) / 4, z = (segment.z0 + segment.z1) / 2, y = (segment.y0 + segment.y1) / 2;
    const ray = new THREE.Raycaster(new THREE.Vector3(x, y - 4, z), new THREE.Vector3(0, 1, 0));
    const hit = ray.intersectObject(mesh)[0];
    assert.ok(hit, `Invisible underside at ${x}, ${z}`);
    assert.ok(hit.face.normal.y < -0.9);
    assert.ok(Math.abs(hit.point.y - (y - DECK_THICKNESS)) < 1e-5);
    const positions = geometry.attributes.position, edges = new Map();
    const vertex = i => [positions.getX(i), positions.getY(i), positions.getZ(i)].join(',');
    for (let i = 0; i < positions.count; i += 3) for (let j = 0; j < 3; j++) {
      const key = [vertex(i + j), vertex(i + (j + 1) % 3)].sort().join('|'); edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    assert.ok([...edges.values()].every(count => count === 2), 'Every slab edge must belong to exactly two faces');
    geometry.dispose();
  }
  mat.dispose();
});

test('sign text faces are visible and have matching readable UV orientation from both directions', () => {
  const frame = new THREE.MeshBasicMaterial(), text = new THREE.MeshBasicMaterial();
  const panel = signPanel(9, 1.6, frame, text);
  for (const side of [-1, 1]) {
    const ray = new THREE.Raycaster(new THREE.Vector3(-side * 2.25, 0, side * 10), new THREE.Vector3(0, 0, -side));
    const hit = ray.intersectObject(panel)[0];
    assert.ok(hit); assert.equal(panel.material[hit.face.materialIndex], text);
    assert.ok(Math.abs(hit.face.normal.z - side) < 1e-5);
    assert.ok(Math.abs(hit.uv.x - 0.25) < 1e-6, 'Text must read left-to-right from each side');
  }
  panel.geometry.dispose(); frame.dispose(); text.dispose();
});

import { PhysicsWorld } from '../src/physics.js';
import RAPIER from '../src/rapier.js';
import { terrainSurfaceHeight, WATER_LEVEL } from '../src/surfaces.js';
import { reverseEngineSamples, impactSamples } from '../src/audio-synthesis.js';

function fixture(context, { terrain = false } = {}) {
  const track = new TrackManager(), physics = new PhysicsWorld(track, { terrain }), player = new VehicleController(0, 40, 0, track);
  physics.reset(player, null); context.after(() => physics.dispose());
  return { track, physics, player };
}
const subDt = PHYSICS.dt / PHYSICS.substeps;
test('physical deck covers every rendered strip through curves, tapers and branch joins', t => {
  const { track, physics, player } = fixture(t);
  // Populate Rapier's spatial query pipeline before casting at the whole track.
  physics.step(player, idle, subDt, null, false);
  for (const segment of track.segments) for (const lane of segment.lanes) {
    for (const along of [0.01, 0.5, 0.99]) for (const across of [0.001, 0.5, 0.999]) {
      const z = segment.z0 + (segment.z1 - segment.z0) * along;
      const left = lane.left0 + (lane.left1 - lane.left0) * along, right = lane.right0 + (lane.right1 - lane.right0) * along;
      const x = left + (right - left) * across, height = segment.y0 + (segment.y1 - segment.y0) * along;
      const hit = physics.world.castRay(new RAPIER.Ray({ x, y: height + 2, z }, { x: 0, y: -1, z: 0 }), 3, true, undefined, undefined, physics.collider, physics.body, c => physics.tags.get(c.handle) === 'road');
      assert.ok(hit, `Missing road collider at ${x}, ${z}`);
      assert.ok(Math.abs(hit.timeOfImpact - 2) < 0.002, `Collider does not match road height at ${x}, ${z}`);
    }
  }
});
function coast(physics, player, seconds, echo = null) {
  let peak = 0, totalImpulse = 0, tags = new Set();
  for (let i = 0; i < seconds / subDt; i++) {
    const result = physics.step(player, idle, subDt, typeof echo === 'function' ? echo((i + 1) * subDt) : echo, false);
    peak = Math.max(peak, result.impact); totalImpulse += result.impact; for (const tag of result.contacts) tags.add(tag);
  }
  return { peak, totalImpulse, tags };
}

test('rigid body tips when its center of mass passes the road edge, in both travel directions', t => {
  const { track, physics, player } = fixture(t);
  for (const yaw of [0, Math.PI]) for (const side of [-1, 1]) {
    physics.reset(player, null);
    physics.teleport(player, { x: side * (track.width(40) / 2 + 0.15), y: 12.65, z: 40 }, rotationFromAngles(yaw));
    coast(physics, player, 1.8);
    assert.ok(player.upright < 0.8, `Car remained artificially upright: ${player.upright}`);
    assert.ok(player.position.y < 11, "Unsupported car must fall, not be held at the edge");
  }
});

test('driving near an edge with the center of mass inside remains stable', t => {
  const { physics, player } = fixture(t);
  physics.teleport(player, { x: 8.8, y: 12.65, z: 40 });
  coast(physics, player, 1);
  assert.ok(player.position.y > 12.4); assert.ok(player.upright > 0.98);
});

test('falling cars hit the vertical road fascia and underside instead of passing through', t => {
  const { physics, player } = fixture(t);
  physics.teleport(player, { x: 13, y: 11.8, z: 40 }, rotationFromAngles(0), { x: -18, y: -1, z: 0 });
  const side = coast(physics, player, 0.22);
  assert.ok(side.tags.has('road')); assert.ok(side.peak > 4); assert.ok(player.position.x > 9.7);
  physics.teleport(player, { x: 0, y: 8, z: 40 }, rotationFromAngles(0), { x: 0, y: 18, z: 0 });
  const below = coast(physics, player, 0.3);
  assert.ok(below.tags.has('road')); assert.ok(player.position.y < 10.4); assert.ok(player.linearVelocity.y < 0);
});

test('bollards are solid at the 360 km/h cap and impart an impulse', t => {
  const { track, physics, player } = fixture(t);
  const post = track.bollards.find(p => p.z === 28 && p.side === 1);
  physics.teleport(player, { x: post.x, y: 12.7, z: post.z - 6 }, rotationFromAngles(0), { x: 0, y: 0, z: VEHICLE.maxSpeed });
  const result = coast(physics, player, 0.15);
  assert.ok(result.tags.has('bollard')); assert.ok(result.peak > 10); assert.ok(player.linearVelocity.z < 70);
});

test('kinematic echo preserves its exact trajectory during repeated high-speed impacts', t => {
  const { physics, player } = fixture(t), original = state(0, 52);
  physics.reset(player, original);
  physics.teleport(player, { x: 0, y: 12.7, z: 40 }, rotationFromAngles(0), { x: 0, y: 0, z: 100 });
  const serialized = JSON.stringify(original); let hit = false;
  for (let i = 1; i <= 120; i++) {
    const echo = state(0, 52 - i * subDt * 100); echo.linearVelocity.z = -100;
    const result = physics.step(player, idle, subDt, echo, false);
    hit ||= result.contacts.has('echo');
    assert.ok(Math.abs(physics.echoBody.translation().z - echo.position.z) < 1e-4);
  }
  assert.ok(hit); assert.ok(player.linearVelocity.z < 0); assert.equal(JSON.stringify(original), serialized);
});

test('terrain collision matches the visible mesh and produces an impact', t => {
  const { track, physics, player } = fixture(t, { terrain: true });
  const x = 50, z = 90, ground = terrainSurfaceHeight(x, z, track);
  physics.teleport(player, { x, y: ground + 10, z }, rotationFromAngles(0), { x: 0, y: -10, z: 0 });
  const result = coast(physics, player, 1);
  assert.ok(result.tags.has('terrain'));
  // A sloping bank spreads the landing over multiple contact steps and moves
  // the car downhill. Compare against the surface at its final position.
  assert.ok(result.peak > 5); assert.ok(result.totalImpulse > 20);
  assert.ok(player.position.y > terrainSurfaceHeight(player.position.x, player.position.z, track));
});

test('falls reach water, sink visibly, then await a choice without replacing valid history', t => {
  const run = new RunManager(new TrackManager()); t.after(() => run.physics.dispose()); run.history = makeReplay(); run.direction = -1; run.runNumber = 2; run.restart();
  const history = run.history;
  run.physics.teleport(run.player, { x: 18, y: 5, z: 40 }, rotationFromAngles(0), { x: 0, y: -4, z: 0 });
  for (let i = 0; i < 240 && !run.crash; i++) run.step(idle);
  assert.equal(run.crash?.kind, 'water'); assert.equal(run.crash.position.y, WATER_LEVEL); assert.equal(run.history, history);
  const y = run.player.position.y;
  for (let i = 0; i < 90; i++) run.step(idle);
  assert.ok(run.physics.collider.isEnabled());
  assert.ok(run.player.position.y < WATER_LEVEL);
  assert.ok(run.player.position.y > terrainSurfaceHeight(run.player.position.x, run.player.position.z, run.track));
  assert.equal(run.status, 'crashing');
  for (let i = 0; i < 800 && run.status !== 'decision'; i++) run.step(idle);
  assert.equal(run.status, 'decision'); run.restart();
  assert.equal(run.status, 'playing'); assert.equal(run.direction, -1); assert.equal(run.runNumber, 2); assert.equal(run.history, history); assert.equal(run.crash, null);
});

test('terrain crashes show an impact sequence and pause freezes the crash animation', t => {
  const run = new RunManager(new TrackManager()); t.after(() => run.physics.dispose()); run.start();
  run.physics.teleport(run.player, { x: 55, y: 30, z: 90 }, rotationFromAngles(0), { x: 0, y: -45, z: 0 });
  for (let i = 0; i < 240 && !run.crash; i++) run.step(idle);
  assert.equal(run.crash?.kind, 'terrain'); assert.ok(run.crash.impact > 10);
  const age = run.crash.age, position = { ...run.player.position }; run.paused = true;
  for (let i = 0; i < 120; i++) run.step(idle);
  assert.equal(run.crash.age, age); assert.deepEqual(run.player.position, position);
});

test('four alternating runs still complete through both branches and jumps with rigid-body physics', t => {
  const run = new RunManager(new TrackManager()); t.after(() => run.physics.dispose()); run.start(); let airborne = 0;
  for (let n = 0; n < 4; n++) {
    let steps = 0;
    while (run.status === 'playing' && steps++ < 120 * 80) {
      run.step(driveInput(run, n % 2 ? 1 : -1, 25));
      if (!run.player.grounded && run.player.position.z > 410 && run.player.position.z < 470) airborne++;
    }
    assert.equal(run.status, 'transition', `Run ${n + 1}: ${run.notice}; ${JSON.stringify(run.player.position)}; checkpoints ${run.checkpoints.next}`);
    assert.equal(run.history.frames.length, run.ticks + 1); assert.equal(run.history.duration, run.elapsed);
    const history = run.history; run.advance(); assert.equal(run.echo.replay, history);
  }
  assert.ok(airborne > 20);
});

test('reverse audio is reproducible, non-silent and exactly matches replay duration', () => {
  const replay = makeReplay(), a = reverseEngineSamples(replay, 22050), b = reverseEngineSamples(replay, 22050);
  assert.deepEqual(a, b); assert.equal(a.length, Math.ceil(replay.duration * 22050)); assert.ok(a.some(v => Math.abs(v) > 0.1)); assert.ok(a.every(Number.isFinite));
  for (const kind of ['terrain', 'water']) { const samples = impactSamples(kind); assert.ok(samples.some(v => Math.abs(v) > 0.1)); assert.ok(samples.every(Number.isFinite)); }
});
