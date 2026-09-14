import { performance } from 'node:perf_hooks';
import { TrackManager } from '../src/track.js';
import { PhysicsWorld } from '../src/physics.js';
import { VehicleController, rotationFromAngles } from '../src/vehicle.js';
import { PHYSICS } from '../src/config.js';

// Reference mode changes only spatial partitioning, not solids, CCD or timesteps.
const reference = process.argv.includes('--reference'), samples = [];
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false }, dt = PHYSICS.dt / PHYSICS.substeps;
for (const scenario of ['road', 'echo', 'water']) for (let trial = 0; trial < 3; trial++) {
  const track = new TrackManager(), physics = new PhysicsWorld(track, reference ? { roadSectionLength: Infinity, terrainSectionSize: Infinity } : {}), player = new VehicleController(0, 20, 0, track);
  physics.reset(player, null);
  if (scenario === 'water') physics.teleport(player, { x: 18, y: -0.4, z: 40 });
  const profile = { world: 0, tires: 0, water: 0 }, stepTimes = [];
  for (const [owner, name, bucket] of [[physics.world, 'step', 'world'], [physics, 'drive', 'tires'], [physics.water, 'apply', 'water']]) {
    const method = owner[name].bind(owner);
    owner[name] = (...args) => { const start = performance.now(), result = method(...args); profile[bucket] += performance.now() - start; return result; };
  }
  for (let i = 0; i < 120; i++) physics.step(player, idle, dt, null);
  for (const key in profile) profile[key] = 0;
  const steps = Math.round(5 / dt), begin = performance.now();
  for (let i = 0; i < steps; i++) {
    const echo = scenario === 'echo' ? { position: { x: 3, y: 12.68, z: 80 - i * dt * 8 }, rotation: rotationFromAngles(0), linearVelocity: { x: 0, y: 0, z: -8 }, angularVelocity: { x: 0, y: 0, z: 0 } } : null;
    const start = performance.now();
    physics.step(player, { ...idle, throttle: scenario !== 'water' && player.speed < 8 ? 1 : 0 }, dt, echo);
    stepTimes.push(performance.now() - start);
  }
  const elapsed = performance.now() - begin; stepTimes.sort((a, b) => a - b);
  samples.push({ scenario, trial, elapsedMs: elapsed, p95StepMs: stepTimes[Math.floor(steps * 0.95)], ...profile }); physics.dispose();
}
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(JSON.stringify({ mode: reference ? 'reference' : 'optimized', simulatedSecondsPerTrial: 5, physicsHz: 1 / dt, scenarios: ['road', 'echo', 'water'].map(scenario => { const rows = samples.filter(r => r.scenario === scenario); return Object.fromEntries([['scenario', scenario], ...['elapsedMs', 'p95StepMs', 'world', 'tires', 'water'].map(key => [key, Number(median(rows.map(r => r[key])).toFixed(3))])]); }) }, null, 2));
