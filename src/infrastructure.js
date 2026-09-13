import { terrainSurfaceHeight, DECK_THICKNESS } from './surfaces.js';
const cache = new WeakMap();
/** Authoritative structural objects consumed by both rendering and physics. */
export function infrastructure(track) {
  if (cache.has(track)) return cache.get(track);
  const objects = [];
  const box = (tag, material, size, position, text) => objects.push({ id: `${tag}-${objects.length}`, tag, material, size, position, text });
  for (let z = 0; z <= track.length; z += 28) for (const lane of track.lanes(z)) {
    const base = terrainSurfaceHeight(lane.center, z, track), bottom = track.height(z) - DECK_THICKNESS;
    box('pier', 'concrete', [1.3, bottom - base, 2], [lane.center, (bottom + base) / 2, z]);
    box('pier', 'concrete', [lane.width * 0.78, 0.5, 1.8], [lane.center, bottom - 0.25, z]);
    box('pier', 'concrete', [2.5, 0.8, 3], [lane.center, base + 0.4, z]);
  }
  for (const p of track.bollards) {
    box('bollard', 'dark', [0.14, 1.2, 0.16], [p.x, p.y + 0.55, p.z]);
    box('bollard', 'lime', [0.2, 0.24, 0.2], [p.x, p.y + 1.25, p.z]);
    box('bollard', 'concrete', [0.85, 0.15, 0.3], [p.x - p.side * 0.3, p.y - 0.15, p.z]);
  }
  for (const { x, y, z, width, height, text } of track.signs) {
    const panelY = y + 4.4;
    for (const side of [-1, 1]) {
      const px = x + side * width * 0.3, base = terrainSurfaceHeight(px, z, track), top = panelY - height / 2 + 0.1, footing = Math.max(base + 0.6, -0.3);
      box('sign-post', 'concrete', [0.3, top - base, 0.3], [px, (top + base) / 2, z]);
      box('sign-post', 'concrete', [1, footing - base, 1.1], [px, (footing + base) / 2, z]);
    }
    box('sign', 'dark', [width * 0.8, 0.16, 0.38], [x, panelY - 0.6, z]);
    box('sign', 'dark', [width, height, 0.24], [x, panelY, z], text);
  }
  for (const [z, text] of [[track.a, 'A / ORIGIN'], [track.b, 'B / INVERSION']]) {
    const lane = track.lanes(z)[0], x = lane.center, y = track.height(z), half = lane.width / 2;
    for (const side of [-1, 1]) {
      box('gate', 'dark', [0.6, 7, 0.7], [x + side * (half + 0.5), y + 3.5, z]);
      box('gate', 'lime', [0.12, 6, 0.78], [x + side * (half + 0.15), y + 3.5, z]);
    }
    box('gate', 'dark', [lane.width + 1.6, 1.25, 0.75], [x, y + 7, z]);
    box('gate', 'dark', [13, 1.06, 0.8], [x, y + 7, z], text);
  }
  cache.set(track, objects); return objects;
}
