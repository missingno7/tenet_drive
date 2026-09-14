import { clamp, lerp } from './config.js';
export const DECK_THICKNESS = 1.1;
export const WATER_LEVEL = -0.8;
export const TERRAIN = Object.freeze({ width: 1000, depth: 1350, columns: 180, rows: 240, centerZ: 300 });
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function terrainHeight(x, z, track) {
  const distance = Math.abs(x - track.center(clamp(z, 0, track.length)));
  const hills = 3.2 + Math.sin(x * 0.038 + z * 0.014) * 2.7 + Math.cos(z * 0.041) * Math.sin(x * 0.071) * 1.8;
  const ridge = Math.max(0, distance - 65) * 0.065 * (0.5 + 0.5 * Math.sin(z * 0.013 + 0.8) ** 2);
  const detail = Math.sin(x * 0.19 + z * 0.17) * 0.24 + Math.cos(z * 0.23 - x * 0.11) * 0.19;
  return lerp(-4, hills + ridge + detail, smooth(18, 43, distance));
}
const terrainCache = new WeakMap();
export function terrainMeshData(track) {
  if (terrainCache.has(track)) return terrainCache.get(track);
  const { width, depth, columns, rows, centerZ } = TERRAIN, vertices = [], indices = [];
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    const x = -width / 2 + col / columns * width, z = centerZ - depth / 2 + row / rows * depth;
    vertices.push(x, terrainHeight(x, z, track), z);
  }
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const a = row * (columns + 1) + col, b = a + columns + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const data = { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) }; terrainCache.set(track, data); return data;
}
export function terrainSurfaceHeight(x, z, track) {
  const { width, depth, columns, rows, centerZ } = TERRAIN;
  const u = clamp((x + width / 2) / width * columns, 0, columns - 1e-6), v = clamp((z - centerZ + depth / 2) / depth * rows, 0, rows - 1e-6);
  const col = Math.floor(u), row = Math.floor(v), tx = u - col, tz = v - row, a = row * (columns + 1) + col, b = a + columns + 1;
  const values = terrainMeshData(track).vertices, h = i => values[i * 3 + 1];
  return tx + tz <= 1 ? h(a) + tx * (h(a + 1) - h(a)) + tz * (h(b) - h(a)) : h(b + 1) + (1 - tx) * (h(b) - h(b + 1)) + (1 - tz) * (h(a + 1) - h(b + 1));
}
export function slabData(segment, lane, thickness = DECK_THICKNESS, caps = true) {
  const { z0, z1, y0, y1 } = segment;
  const vertices = [lane.left0, y0, z0, lane.right0, y0, z0, lane.right1, y1, z1, lane.left1, y1, z1, lane.left0, y0 - thickness, z0, lane.right0, y0 - thickness, z0, lane.right1, y1 - thickness, z1, lane.left1, y1 - thickness, z1];
  const indices = [0, 3, 1, 1, 3, 2, 4, 5, 7, 5, 6, 7, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
  if (caps || z0 === 0) indices.push(0, 1, 5, 0, 5, 4);
  if (caps || z1 === 620) indices.push(3, 7, 6, 3, 6, 2);
  return { vertices, indices };
}
export function roadMeshData(track) {
  const vertices = [], indices = [], welded = new Map();
  for (const segment of track.segments) for (const lane of segment.lanes) {
    const data = slabData(segment, lane, DECK_THICKNESS, false), map = [];
    for (let i = 0; i < data.vertices.length; i += 3) {
      const point = data.vertices.slice(i, i + 3), key = point.map(v => v.toFixed(5)).join(',');
      if (!welded.has(key)) { welded.set(key, vertices.length / 3); vertices.push(...point); }
      map.push(welded.get(key));
    }
    indices.push(...data.indices.map(i => map[i]));
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}

/** Compact local triangle meshes, retaining winding and every source face. */
export function partitionMesh(source, sectionSize, axes = [0, 2]) {
  if (sectionSize === Infinity) return [source];
  if (!(sectionSize > 0 && Number.isFinite(sectionSize))) throw new Error('Invalid collision section size');
  const sections = new Map();
  for (let i = 0; i < source.indices.length; i += 3) {
    const ids = source.indices.subarray(i, i + 3);
    const key = axes.map(axis => Math.floor((source.vertices[ids[0] * 3 + axis] + source.vertices[ids[1] * 3 + axis] + source.vertices[ids[2] * 3 + axis]) / (3 * sectionSize))).join(',');
    if (!sections.has(key)) sections.set(key, { vertices: [], indices: [], remap: new Map() });
    const section = sections.get(key);
    for (const id of ids) {
      if (!section.remap.has(id)) {
        section.remap.set(id, section.vertices.length / 3);
        section.vertices.push(...source.vertices.subarray(id * 3, id * 3 + 3));
      }
      section.indices.push(section.remap.get(id));
    }
  }
  return [...sections.values()].map(s => ({ vertices: new Float32Array(s.vertices), indices: new Uint32Array(s.indices) }));
}
export function roadCollisionMeshes(track, sectionLength = 64) {
  return partitionMesh(roadMeshData(track), sectionLength, [2]);
}
export function terrainCollisionMeshes(track, sectionSize = 128) {
  return partitionMesh(terrainMeshData(track), sectionSize);
}
