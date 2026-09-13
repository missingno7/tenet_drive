import * as THREE from 'three';

import { slabData, DECK_THICKNESS } from './surfaces.js';
export { DECK_THICKNESS } from './surfaces.js';

/** A closed trapezoidal prism. Top vertices are the unchanged physics footprint. */
export function roadSlabGeometry(segment, lane, thickness = DECK_THICKNESS) {
  const { vertices, indices } = slabData(segment, lane, thickness);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(indices.flatMap(i => vertices.slice(i * 3, i * 3 + 3)), 3));
  geometry.addGroup(0, 6, 0); geometry.addGroup(6, 30, 1);
  geometry.computeVertexNormals();
  return geometry;
}

/** BoxGeometry gives both +/-Z faces outward-facing, readable UVs. */
export function signPanel(width, height, frameMaterial, textMaterial) {
  const panel = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.24), [frameMaterial, frameMaterial, frameMaterial, frameMaterial, textMaterial, textMaterial]);
  panel.castShadow = true; panel.receiveShadow = true;
  return panel;
}
