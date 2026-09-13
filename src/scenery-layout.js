import { clamp } from './config.js';
import { terrainSurfaceHeight } from './surfaces.js';
export function randomSource(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const cache = new WeakMap();
export function sceneryLayout(track) {
  if (cache.has(track)) return cache.get(track);
  const random = randomSource(45128), buildings = [], trees = [], rocks = [];
  for (let i = 0; i < 34; i++) {
    const side = i % 2 ? -1 : 1, z = -45 + i * 23 + random() * 15, x = track.center(clamp(z, 0, track.length)) + side * (82 + random() * 155);
    const width = 13 + random() * 17, depth = 13 + random() * 18, height = 24 + random() * 88, base = terrainSurfaceHeight(x, z, track), yaw = (random() - 0.5) * 0.55;
    buildings.push({ x, z, width, depth, height, base, yaw, radius: Math.hypot(width, depth) / 2 + 3 });
  }
  for (let i = 0; i < 1400 && trees.length < 480; i++) {
    const z = -95 + random() * 860, side = random() < 0.5 ? -1 : 1, x = track.center(clamp(z, 0, track.length)) + side * (25 + random() * 145), y = terrainSurfaceHeight(x, z, track);
    if (y < 0.65 || buildings.some(b => Math.hypot(b.x - x, b.z - z) < b.radius)) continue;
    trees.push({ x, y, z, height: 4.5 + random() * 6, radius: 1.4 + random() * 1.1, pine: random() < 0.7 });
  }
  for (let i = 0; i < 160; i++) {
    const z = -65 + random() * 790, x = track.center(clamp(z, 0, track.length)) + (i % 2 ? -1 : 1) * (30 + random() * 25), y = terrainSurfaceHeight(x, z, track), size = 0.5 + random() * 1.8;
    rocks.push({ x, y: y + size * 0.3, z, size, rotation: [random(), random(), random()] });
  }
  const data = { buildings, trees, rocks }; cache.set(track, data); return data;
}
// Same icosahedron points for rock rendering and its convex collider.
const f = (1 + Math.sqrt(5)) / 2, n = Math.hypot(1, f);
export const ROCK_VERTICES = [-1,f,0,1,f,0,-1,-f,0,1,-f,0,0,-1,f,0,1,f,0,-1,-f,0,1,-f,f,0,-1,f,0,1,-f,0,-1,-f,0,1].map(v => v / n);
