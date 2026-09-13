import * as THREE from 'three';
import { VEHICLE, lerp } from './config.js';
import { interpolateState } from './replay.js';
import { buildScenery, terrainHeight } from './scenery.js';
import { DECK_THICKNESS, roadSlabGeometry, signPanel } from './world-geometry.js';
import { ImpactEffects } from './impact-effects.js';

const COLORS = { road: 0x303f48, curb: 0xecddd0, orange: 0xf46840, lime: 0xddf78a, echo: 0xf684de };
const material = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.68, ...extra });
const roadMat = material(COLORS.road);
const wallMat = material(0x657b80);
const curbMat = material(COLORS.curb);
const orangeMat = material(COLORS.orange);
const darkMat = material(0x17242d);
const limeMat = material(COLORS.lime, { emissive: COLORS.lime, emissiveIntensity: 0.2 });
function block(w, h, d, mat, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
function strip(points, mat) {
  const positions = [], indices = [];
  for (const p of points) positions.push(p[0], p[1], p[2], p[3], p[4], p[5]);
  for (let i = 0; i < points.length - 1; i++) { const n = i * 2; indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setIndex(indices); geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; return mesh;
}
function label(text, color = '#dff38e', width = 512, height = 128) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#17242d'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color; ctx.font = `bold ${Math.round(height * 0.45)}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: texture });
}
function car(echo = false) {
  const group = new THREE.Group();
  const paint = material(echo ? 0xd574c7 : 0xff643e, { metalness: 0.35, roughness: 0.33, emissive: echo ? 0x7a1c70 : 0x200500, emissiveIntensity: echo ? 0.25 : 0.06 });
  const glass = material(echo ? 0x2f1239 : 0x15252e, { metalness: 0.65, roughness: 0.2 });
  const neon = material(echo ? 0xffa2ee : 0xe4f6ed, { emissive: echo ? 0xf16fda : 0xe4f6ed, emissiveIntensity: 1.6 });
  group.add(block(1.82, 0.43, 3.75, paint, 0, -0.07, 0));
  group.add(block(1.91, 0.14, 3.95, darkMat, 0, -0.33, 0));
  const cabin = block(1.48, 0.52, 1.65, glass, 0, 0.39, -0.26); group.add(cabin);
  group.add(block(1.52, 0.06, 1.32, paint, 0, 0.67, -0.4));
  group.add(block(0.17, 0.022, 1.06, curbMat, -0.32, 0.155, 1.24));
  group.add(block(0.17, 0.022, 1.06, curbMat, 0.32, 0.155, 1.24));
  group.add(block(0.5, 0.1, 0.05, neon, -0.57, 0.07, 1.9), block(0.5, 0.1, 0.05, neon, 0.57, 0.07, 1.9));
  const tail = material(0xff5038, { emissive: 0xff2200, emissiveIntensity: 0.7 });
  group.add(block(1.5, 0.08, 0.06, echo ? neon : tail, 0, 0.02, -1.91));
  group.add(block(1.96, 0.09, 0.4, darkMat, 0, 0.48, -1.63));
  for (const x of [-0.62, 0.62]) group.add(block(0.09, 0.35, 0.08, darkMat, x, 0.26, -1.62));
  const wheels = [];
  const rubber = material(0x101a20);
  const rim = material(echo ? 0xf3a0e9 : 0xa7b5b6, { metalness: 0.75, roughness: 0.25 });
  for (const x of [-VEHICLE.wheelHalfTrack, VEHICLE.wheelHalfTrack]) for (const z of [VEHICLE.rearAxle, VEHICLE.frontAxle]) {
    const wheel = new THREE.Group(); wheel.position.set(x, -0.25, z);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.24, 12), rubber); tire.rotation.z = Math.PI / 2; tire.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.26, 8), rim); hub.rotation.z = Math.PI / 2;
    wheel.add(tire, hub); group.add(wheel); wheels.push(wheel);
  }
  if (echo) {
    group.add(block(0.04, 0.03, 3.7, neon, -0.91, 0.16, 0), block(0.04, 0.03, 3.7, neon, 0.91, 0.16, 0));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.022, 4, 48), neon); ring.rotation.x = Math.PI / 2; ring.position.y = -0.57; group.add(ring);
  }
  group.userData.wheels = wheels;
  return group;
}

export class CameraController {
  constructor(camera) { this.camera = camera; this.look = new THREE.Vector3(); this.initialized = false; }
  reset() { this.initialized = false; }
  update(state, direction, dt, speed, intro = false) {
    const p = new THREE.Vector3(state.position.x, state.position.y, state.position.z);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(state.rotation.x, state.rotation.y, state.rotation.z, state.rotation.w));
    // Direction anchor prevents a collision spin or reverse gear from whipping the view around.
    const heading = new THREE.Vector3(facing.x * 0.5, 0, direction * 0.85 + facing.z * 0.15).normalize();
    const desired = p.clone().addScaledVector(heading, intro ? -14 : -10.5 - speed * 0.05); desired.y += intro ? 7.5 : 5.7 + speed * 0.025;
    if (intro) desired.x += 6;
    const target = p.clone().addScaledVector(heading, 10 + speed * 0.2); target.y += 0.6;
    const a = this.initialized ? 1 - Math.exp(-6 * dt) : 1;
    this.camera.position.lerp(desired, a); this.look.lerp(target, a); this.camera.lookAt(this.look);
    const fov = 56 + Math.min(8, speed * 0.16);
    this.camera.fov = lerp(this.camera.fov, fov, a); this.camera.updateProjectionMatrix(); this.initialized = true;
  }
}

export class WorldRenderer {
  constructor(canvas, track) {
    this.track = track; this.debug = false; this.history = null;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.2;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0xb4ced0); this.scene.fog = new THREE.Fog(0xb4ced0, 150, 570);
    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 850);
    this.chase = new CameraController(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xf5ffff, 0x536567, 1.65));
    this.sun = new THREE.DirectionalLight(0xffedd1, 3.3); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); Object.assign(this.sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 260 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.normalBias = 0.04; this.sun.shadow.bias = -0.00015;
    this.scene.add(this.sun, this.sun.target);
    this.buildEnvironment(); this.buildTrack();
    this.player = car(); this.echo = car(true); this.scene.add(this.player, this.echo);
    this.impactEffects = new ImpactEffects(this.scene);
    const colliderGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(VEHICLE.halfWidth * 2, VEHICLE.halfHeight * 2, VEHICLE.halfLength * 2));
    this.playerBox = new THREE.LineSegments(colliderGeo, new THREE.LineBasicMaterial({ color: 0xdff98b }));
    this.echoBox = new THREE.LineSegments(colliderGeo, new THREE.LineBasicMaterial({ color: 0xff9bec })); this.scene.add(this.playerBox, this.echoBox);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.distanceLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff })); this.scene.add(this.distanceLine);
    this.particles = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.065), new THREE.MeshBasicMaterial({ color: 0xffb5f0 }), 26); this.scene.add(this.particles);
    this.particleDummy = new THREE.Object3D();
    this.skids = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.17, 0.65), new THREE.MeshBasicMaterial({ color: 0x10171e, transparent: true, opacity: 0.65, depthWrite: false }), 600);
    this.skids.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.skids.count = 0; this.skidIndex = 0; this.scene.add(this.skids); this.lastSkid = 0;
    this.resize(); window.addEventListener('resize', () => this.resize());
  }
  resize() { this.renderer.setSize(innerWidth, innerHeight); this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
  buildEnvironment() {
    this.scenery = buildScenery(this.scene, this.track);
  }
  buildTrack() {
    const track = this.track, edges = [];
    for (const segment of track.segments) {
      const { z0: z, z1: next, y0, y1 } = segment;
      for (const lane of segment.lanes) {
        const deck = new THREE.Mesh(roadSlabGeometry(segment, lane), [roadMat, wallMat]);
        deck.castShadow = true; deck.receiveShadow = true; deck.name = 'road-deck'; this.scene.add(deck);
        for (const side of [-1, 1]) {
          const x0 = side < 0 ? lane.left0 : lane.right0, x1 = side < 0 ? lane.left1 : lane.right1;
          // Paint lies entirely on the supported deck, right up to its boundary.
          const points = [[side < 0 ? x0 : x0 - 0.4, y0 + 0.018, z, side < 0 ? x0 + 0.4 : x0, y0 + 0.018, z], [side < 0 ? x1 : x1 - 0.4, y1 + 0.018, next, side < 0 ? x1 + 0.4 : x1, y1 + 0.018, next]];
          this.scene.add(strip(points, z % 8 < 4 ? orangeMat : curbMat));
          edges.push(x0, y0 + 0.15, z, x1, y1 + 0.15, next);
        }
        if (z % 12 < 5) {
          const c0 = (lane.left0 + lane.right0) / 2, c1 = (lane.left1 + lane.right1) / 2;
          this.scene.add(strip([[c0 - 0.055, y0 + 0.018, z, c0 + 0.055, y0 + 0.018, z], [c1 - 0.055, y1 + 0.018, next, c1 + 0.055, y1 + 0.018, next]], curbMat));
        }
      }
    }
    for (let z = 0; z <= track.length; z += 28) for (const lane of track.lanes(z)) {
      const base = terrainHeight(lane.center, z, track), underside = track.height(z) - DECK_THICKNESS;
      this.scene.add(block(1.3, underside - base, 2, wallMat, lane.center, (underside + base) / 2, z));
      this.scene.add(block(lane.width * 0.78, 0.5, 1.8, wallMat, lane.center, underside - 0.25, z));
      this.scene.add(block(2.5, 0.8, 3, wallMat, lane.center, base + 0.4, z));
    }
    for (const { x, y, z, side } of track.bollards) {
      this.scene.add(block(0.14, 1.2, 0.16, darkMat, x, y + 0.55, z));
      this.scene.add(block(0.2, 0.24, 0.2, limeMat, x, y + 1.25, z));
      this.scene.add(block(0.85, 0.15, 0.3, wallMat, x - side * 0.3, y - 0.15, z));
    }
    const boundsGeo = new THREE.BufferGeometry(); boundsGeo.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
    this.bounds = new THREE.LineSegments(boundsGeo, new THREE.LineBasicMaterial({ color: 0xffcc6a })); this.scene.add(this.bounds);
    this.gate(track.a, 'A', 'ORIGIN'); this.gate(track.b, 'B', 'INVERSION');
    for (const { x, y, z, text, width, height } of track.signs) {
      const panelY = y + 4.4;
      for (const side of [-1, 1]) {
        const postX = x + side * width * 0.3, ground = terrainHeight(postX, z, track);
        const postTop = panelY - height / 2 + 0.1;
        this.scene.add(block(0.3, postTop - ground, 0.3, wallMat, postX, (postTop + ground) / 2, z));
        const footingTop = Math.max(ground + 0.6, -0.3);
        this.scene.add(block(1, footingTop - ground, 1.1, wallMat, postX, (footingTop + ground) / 2, z));
      }
      this.scene.add(block(width * 0.8, 0.16, 0.38, darkMat, x, panelY - 0.6, z));
      const sign = signPanel(width, height, darkMat, label(text)); sign.position.set(x, panelY, z); sign.name = 'roadside-sign'; this.scene.add(sign);
    }
    for (const z of [405, 450]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(13, 0.24, 6, 64), orangeMat); ring.position.set(track.center(z), 15, z); this.scene.add(ring);
    }
    for (let z = 414; z <= 442; z += 4) {
      const bar = block(17.8, 0.02, 0.2, limeMat, track.center(z), track.height(z) + 0.035, z); this.scene.add(bar);
    }
  }
  gate(z, letter, title) {
    const lane = this.track.lanes(z)[0], x = lane.center, y = this.track.height(z), halfWidth = lane.width / 2;
    for (const side of [-1, 1]) { this.scene.add(block(0.6, 7, 0.7, darkMat, x + side * (halfWidth + 0.5), y + 3.5, z)); this.scene.add(block(0.12, 6, 0.78, limeMat, x + side * (halfWidth + 0.15), y + 3.5, z)); }
    this.scene.add(block(lane.width + 1.6, 1.25, 0.75, darkMat, x, y + 7, z));
    const sign = signPanel(13, 1.06, darkMat, label(`${letter}  /  ${title}`)); sign.scale.z = 3.3; sign.position.set(x, y + 7, z); this.scene.add(sign);
    const cellWidth = lane.width / 20;
    for (let i = 0; i < 20; i++) for (let j = 0; j < 2; j++) this.scene.add(block(cellWidth, 0.025, 0.7, (i + j) % 2 ? darkMat : curbMat, lane.left + (i + 0.5) * cellWidth, y + 0.025, z - 0.7 + j * 0.7));
  }
  setDebug(value) { this.debug = value; }
  updateHistory(history) {
    if (this.history === history) return;
    this.history = history;
    for (const item of [this.path, this.samples]) if (item) { this.scene.remove(item); item.geometry.dispose(); item.material.dispose(); }
    if (!history) { this.path = null; this.samples = null; return; }
    const points = history.frames.filter((_, i) => i % 6 === 0).map(f => new THREE.Vector3(f.position.x, f.position.y, f.position.z));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.path = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xf9a3ee }));
    this.samples = new THREE.Points(geometry.clone(), new THREE.PointsMaterial({ color: 0xffffff, size: 0.15 }));
    this.scene.add(this.path, this.samples);
  }
  pose(mesh, state) {
    mesh.position.set(state.position.x, state.position.y, state.position.z);
    mesh.quaternion.set(state.rotation.x, state.rotation.y, state.rotation.z, state.rotation.w);
  }
  render(run, alpha, dt, wallTime) {
    this.impactEffects.update(run.crash);
    this.updateHistory(run.history);
    const playing = run.status === 'playing' && !run.paused;
    const state = playing ? interpolateState(run.previousPlayer, run.player, alpha) : run.player;
    this.pose(this.player, state);
    const renderTime = playing ? Math.max(0, run.elapsed - (1 - alpha) / 120) : run.elapsed;
    const echoState = run.echo?.sample(renderTime);
    this.echo.visible = !!echoState;
    if (echoState) this.pose(this.echo, echoState);
    for (const mesh of [this.player, this.echo]) for (const wheel of mesh.userData.wheels) {
      if (playing) wheel.rotation.x += (mesh === this.player ? run.player.speed : -Math.hypot(echoState?.linearVelocity.x ?? 0, echoState?.linearVelocity.z ?? 0)) * dt / 0.39;
    }
    this.chase.update(state, run.direction, dt, run.player.speed, run.status === 'intro');
    const p = state.position; this.sun.position.set(p.x - 55, p.y + 85, p.z - 30); this.sun.target.position.set(p.x, p.y, p.z + 20);
    this.playerBox.visible = this.debug; this.echoBox.visible = this.debug && !!echoState; this.bounds.visible = this.debug;
    this.pose(this.playerBox, run.player); if (run.echoState) this.pose(this.echoBox, run.echoState);
    if (this.path) this.path.visible = this.debug; if (this.samples) this.samples.visible = this.debug;
    this.distanceLine.visible = this.debug && !!run.echoState;
    if (run.echoState) {
      const pos = this.distanceLine.geometry.attributes.position;
      pos.setXYZ(0, run.player.position.x, run.player.position.y, run.player.position.z); pos.setXYZ(1, run.echoState.position.x, run.echoState.position.y, run.echoState.position.z); pos.needsUpdate = true;
      this.distanceLine.geometry.computeBoundingSphere();
    }
    this.particles.visible = !!echoState;
    if (echoState) {
      for (let i = 0; i < 26; i++) {
        // These motes converge from past playback positions into the authoritative car.
        const phase = (i / 26 + renderTime * 1.2) % 1;
        const past = run.echo.sample(Math.max(0, renderTime - (1 - phase) * 0.45));
        const q = past?.position ?? echoState.position;
        this.particleDummy.position.set(q.x + Math.sin(i * 2.4) * (1 - phase) * 1.8, q.y + 0.1 + (1 - phase) * 0.5, q.z);
        this.particleDummy.scale.setScalar(0.4 + phase); this.particleDummy.updateMatrix(); this.particles.setMatrixAt(i, this.particleDummy.matrix);
      }
      this.particles.instanceMatrix.needsUpdate = true; this.particles.computeBoundingSphere();
    }
    if (playing && run.player.drifting && wallTime - this.lastSkid > 0.035) {
      this.lastSkid = wallTime;
      for (const side of [-1, 1]) {
        this.particleDummy.position.set(p.x + Math.cos(run.player.yaw) * side * 0.8, this.track.height(p.z) + 0.025, p.z - Math.sin(run.player.yaw) * side * 0.8);
        this.particleDummy.rotation.set(-Math.PI / 2, 0, run.player.yaw); this.particleDummy.scale.setScalar(1); this.particleDummy.updateMatrix();
        this.skids.setMatrixAt(this.skidIndex++ % 600, this.particleDummy.matrix);
      }
      this.skids.count = Math.min(600, this.skidIndex); this.skids.instanceMatrix.needsUpdate = true; this.skids.computeBoundingSphere();
      this.particleDummy.rotation.set(0, 0, 0);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
