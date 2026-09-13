import * as THREE from 'three';
import { clamp } from './config.js';
import { terrainHeight, terrainSurfaceHeight, terrainMeshData, WATER_LEVEL } from './surfaces.js';
export { terrainSurfaceHeight as terrainHeight } from './surfaces.js';

function randomSource(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const surfaceMaterial = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.88, ...extra });


function facadeMaterial() {
  const canvas = document.createElement('canvas'), glow = document.createElement('canvas');
  canvas.width = glow.width = 128; canvas.height = glow.height = 192;
  const ctx = canvas.getContext('2d'), emissive = glow.getContext('2d'), random = randomSource(8301);
  ctx.fillStyle = '#45585c'; ctx.fillRect(0, 0, 128, 192);
  emissive.fillStyle = '#000000'; emissive.fillRect(0, 0, 128, 192);
  for (let row = 0; row < 8; row++) for (let col = 0; col < 6; col++) {
    const x = col * 21 + 3, y = row * 24 + 4, lit = random() > 0.82;
    ctx.fillStyle = lit ? '#c2baa0' : ['#203c48', '#335662', '#52717a', '#719096'][Math.floor(random() * 4)];
    ctx.fillRect(x, y, 14, 16);
    ctx.fillStyle = lit ? '#e2cf9f' : '#8aa4a6'; ctx.fillRect(x, y, 14, 2);
    ctx.fillStyle = '#263e44'; ctx.fillRect(x + 7, y, 1, 16);
    if (lit) { emissive.fillStyle = '#e6c37c'; emissive.fillRect(x, y, 14, 16); }
  }
  ctx.fillStyle = '#819091'; for (let row = 0; row < 8; row++) ctx.fillRect(0, row * 24 + 23, 128, 1);
  const texture = new THREE.CanvasTexture(canvas), lightMap = new THREE.CanvasTexture(glow);
  for (const map of [texture, lightMap]) { map.wrapS = map.wrapT = THREE.RepeatWrapping; map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; }
  return new THREE.MeshStandardMaterial({ map: texture, color: 0xd5dfdc, roughness: 0.48, metalness: 0.22, emissive: 0xffd89b, emissiveMap: lightMap, emissiveIntensity: 0.32 });
}

function buildingGeometry(width, height, depth) {
  const geometry = new THREE.BoxGeometry(width, height, depth), uv = geometry.attributes.uv;
  // Keep the windows approximately the same physical size on every building.
  for (let face = 0; face < 6; face++) for (let corner = 0; corner < 4; corner++) {
    const i = face * 4 + corner;
    uv.setXY(i, uv.getX(i) * (face < 2 ? depth : width) / 15, uv.getY(i) * height / 24);
  }
  return geometry;
}

export function buildScenery(scene, track) {
  const random = randomSource(45128);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(2200, 2200), surfaceMaterial(0x628e94, { metalness: 0.3, roughness: 0.36 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(0, WATER_LEVEL, 300); sea.receiveShadow = true; sea.name = 'river'; scene.add(sea);

  const data = terrainMeshData(track), terrain = new THREE.BufferGeometry();
  terrain.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3)); terrain.setIndex(new THREE.BufferAttribute(data.indices, 1));
  const positions = terrain.attributes.position, colors = [], color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i), y = positions.getY(i);
    const slope = Math.hypot(terrainHeight(x + 2, z, track) - y, terrainHeight(x, z + 2, track) - y) / 2;
    if (y < 0.45) color.set(0x92937d).multiplyScalar(0.91 + random() * 0.12);
    else if (slope > 0.52 || y > 23) color.set(0x778184).multiplyScalar(0.86 + random() * 0.17);
    else color.set(0x68825a).multiplyScalar(0.83 + random() * 0.25);
    colors.push(color.r, color.g, color.b);
  }
  terrain.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); terrain.computeVertexNormals();
  const ground = new THREE.Mesh(terrain, surfaceMaterial(0xffffff, { vertexColors: true }));
  ground.receiveShadow = true; ground.castShadow = true; ground.name = 'riverbank-terrain'; scene.add(ground);

  const facade = facadeMaterial(), roof = surfaceMaterial(0x33464b), foundation = surfaceMaterial(0x8a928b);
  const buildings = [];
  for (let i = 0; i < 34; i++) {
    const side = i % 2 ? -1 : 1, z = -45 + i * 23 + random() * 15;
    const x = track.center(clamp(z, 0, track.length)) + side * (82 + random() * 155);
    const width = 13 + random() * 17, depth = 13 + random() * 18, height = 24 + random() * 88;
    const base = terrainHeight(x, z, track), yaw = (random() - 0.5) * 0.55;
    const group = new THREE.Group(); group.position.set(x, base, z); group.rotation.y = yaw; group.name = 'windowed-tower';
    const body = new THREE.Mesh(buildingGeometry(width, height, depth), [facade, facade, roof, foundation, facade, facade]);
    body.position.y = height / 2; body.castShadow = true; body.receiveShadow = true; group.add(body);
    const footing = new THREE.Mesh(new THREE.BoxGeometry(width + 2, 3, depth + 2), foundation); footing.position.y = -0.5; footing.castShadow = true; footing.receiveShadow = true; group.add(footing);
    const rooftop = new THREE.Mesh(new THREE.BoxGeometry(width * 0.55, 2.4, depth * 0.55), roof); rooftop.position.y = height + 1.2; rooftop.castShadow = true; group.add(rooftop);
    if (i % 3 === 0) {
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.22, 8, 6), roof); spire.position.y = height + 6; group.add(spire);
    }
    scene.add(group); buildings.push({ x, z, radius: Math.hypot(width, depth) / 2 + 3 });
  }

  const trees = [];
  for (let i = 0; i < 1400 && trees.length < 480; i++) {
    const z = -95 + random() * 860, side = random() < 0.5 ? -1 : 1;
    const x = track.center(clamp(z, 0, track.length)) + side * (25 + random() * 145), y = terrainHeight(x, z, track);
    if (y < 0.65 || buildings.some(b => Math.hypot(b.x - x, b.z - z) < b.radius)) continue;
    trees.push({ x, y, z, height: 4.5 + random() * 6, radius: 1.4 + random() * 1.1, pine: random() < 0.7 });
  }
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.23, 1, 6), surfaceMaterial(0x645042), trees.length);
  const needles = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7), surfaceMaterial(0xffffff), trees.filter(t => t.pine).length * 2);
  const leaves = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), surfaceMaterial(0xffffff), trees.filter(t => !t.pine).length);
  const dummy = new THREE.Object3D(); let pineIndex = 0, leafIndex = 0;
  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i], { x, y, z, height, radius } = tree;
    dummy.position.set(x, y + height * 0.25, z); dummy.scale.set(1, height * 0.5, 1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    color.set(tree.pine ? 0x355e4b : 0x5f8048).multiplyScalar(0.78 + random() * 0.4);
    if (tree.pine) {
      for (let tier = 0; tier < 2; tier++) {
        dummy.position.set(x, y + height * (0.53 + tier * 0.23), z); dummy.scale.set(radius * (1 - tier * 0.3), height * 0.58, radius * (1 - tier * 0.3)); dummy.rotation.y = i * 1.4; dummy.updateMatrix();
        needles.setMatrixAt(pineIndex, dummy.matrix); needles.setColorAt(pineIndex++, color);
      }
    } else {
      dummy.position.set(x, y + height * 0.66, z); dummy.scale.set(radius * 1.3, height * 0.4, radius); dummy.rotation.y = i; dummy.updateMatrix(); leaves.setMatrixAt(leafIndex, dummy.matrix); leaves.setColorAt(leafIndex++, color);
    }
  }
  for (const mesh of [trunks, needles, leaves]) { mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'forest'; mesh.computeBoundingSphere(); scene.add(mesh); }

  const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), surfaceMaterial(0x8a9085), 160);
  for (let i = 0; i < 160; i++) {
    const z = -65 + random() * 790, x = track.center(clamp(z, 0, track.length)) + (i % 2 ? -1 : 1) * (30 + random() * 25), y = terrainHeight(x, z, track);
    const size = 0.5 + random() * 1.8;
    dummy.position.set(x, y + size * 0.3, z); dummy.scale.set(size * 1.4, size * 0.8, size); dummy.rotation.set(random(), random(), random()); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
  }
  rocks.castShadow = true; rocks.receiveShadow = true; rocks.name = 'shore-rocks'; rocks.computeBoundingSphere(); scene.add(rocks);
  const sunDisk = new THREE.Mesh(new THREE.SphereGeometry(19, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffedd0, fog: false })); sunDisk.position.set(-230, 185, 380); scene.add(sunDisk);
  return { ground, sea, trees: trees.length, buildings: buildings.length };
}
