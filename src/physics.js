import RAPIER from './rapier.js';
import { PHYSICS, VEHICLE } from './config.js';
import { roadMeshData, terrainMeshData, terrainSurfaceHeight, DECK_THICKNESS, WATER_LEVEL } from './surfaces.js';
import { yawFromRotation, rotateVector } from './vehicle.js';

export class PhysicsWorld {
  constructor(track, { terrain = true } = {}) {
    this.track = track; this.world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 }); this.tags = new Map();
    this.world.numSolverIterations = 8; this.world.integrationParameters.maxCcdSubsteps = 4;
    this.events = new RAPIER.EventQueue(true);
    const road = roadMeshData(track);
    this.addStatic(RAPIER.ColliderDesc.trimesh(road.vertices, road.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.5), 'road');
    if (terrain) { const ground = terrainMeshData(track); this.addStatic(RAPIER.ColliderDesc.trimesh(ground.vertices, ground.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8), 'terrain'); }
    for (const p of track.bollards) {
      this.addBox(0.07, 0.6, 0.08, p.x, p.y + 0.55, p.z, 'bollard');
      this.addBox(0.1, 0.12, 0.1, p.x, p.y + 1.25, p.z, 'bollard');
      this.addBox(0.425, 0.075, 0.15, p.x - p.side * 0.3, p.y - 0.15, p.z, 'bollard');
    }
    for (let z = 0; z <= track.length; z += 28) for (const lane of track.lanes(z)) {
      const base = terrainSurfaceHeight(lane.center, z, track), bottom = track.height(z) - DECK_THICKNESS;
      this.addBox(0.65, (bottom - base) / 2, 1, lane.center, (bottom + base) / 2, z, 'pier');
      this.addBox(lane.width * 0.39, 0.25, 0.9, lane.center, bottom - 0.25, z, 'pier');
    }
  }
  addStatic(desc, tag) { const collider = this.world.createCollider(desc); this.tags.set(collider.handle, tag); return collider; }
  addBox(x, y, z, px, py, pz, tag) { return this.addStatic(RAPIER.ColliderDesc.cuboid(x, y, z).setTranslation(px, py, pz), tag); }
  reset(player, echo) {
    if (this.body) this.world.removeRigidBody(this.body);
    if (this.echoBody) { this.tags.delete(this.echoCollider.handle); this.world.removeRigidBody(this.echoBody); }
    this.echoBody = null;
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(player.position.x, player.position.y, player.position.z).setRotation(player.rotation).setCcdEnabled(true).setAngularDamping(0.35).setCanSleep(false));
    this.collider = this.world.createCollider(RAPIER.ColliderDesc.roundCuboid(VEHICLE.halfWidth - 0.12, VEHICLE.halfHeight - 0.12, VEHICLE.halfLength - 0.12, 0.12).setMass(900).setFriction(0.04).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min).setRestitution(0.15).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(0), this.body);
    this.setEcho(echo, true); this.sync(player);
  }
  setEcho(state, initial = false) {
    if (!state) { if (this.echoBody) { this.tags.delete(this.echoCollider.handle); this.world.removeRigidBody(this.echoBody); this.echoBody = null; } return; }
    if (!this.echoBody) {
      this.echoBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(state.position.x, state.position.y, state.position.z).setRotation(state.rotation));
      this.echoCollider = this.world.createCollider(RAPIER.ColliderDesc.roundCuboid(VEHICLE.halfWidth - 0.12, VEHICLE.halfHeight - 0.12, VEHICLE.halfLength - 0.12, 0.12).setFriction(0.25).setRestitution(VEHICLE.restitution), this.echoBody);
      this.tags.set(this.echoCollider.handle, 'echo');
    }
    if (initial) { this.echoBody.setTranslation(state.position, false); this.echoBody.setRotation(state.rotation, false); }
    this.echoBody.setNextKinematicTranslation(state.position); this.echoBody.setNextKinematicRotation(state.rotation);
  }
  teleport(player, position, rotation = player.rotation, velocity = { x: 0, y: 0, z: 0 }, angular = { x: 0, y: 0, z: 0 }) {
    this.body.setTranslation(position, true); this.body.setRotation(rotation, true); this.body.setLinvel(velocity, true); this.body.setAngvel(angular, true); this.sync(player);
  }
  sync(player) {
    player.position = { ...this.body.translation() }; player.rotation = { ...this.body.rotation() };
    player.linearVelocity = { ...this.body.linvel() }; player.angularVelocity = { ...this.body.angvel() }; player.yaw = yawFromRotation(player.rotation);
    player.grounded = false;
    if (player.upright > 0.4) for (const x of [-VEHICLE.wheelHalfTrack * 0.95, VEHICLE.wheelHalfTrack * 0.95]) for (const z of [VEHICLE.rearAxle, VEHICLE.frontAxle]) {
      const offset = rotateVector({ x, y: 0, z }, player.rotation), p = player.position;
      const ray = new RAPIER.Ray({ x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z }, { x: 0, y: -1, z: 0 });
      const hit = this.world.castRay(ray, 0.82, true, undefined, undefined, this.collider, this.body, c => this.tags.get(c.handle) === 'road');
      if (hit) player.grounded = true;
    }
  }
  step(player, input, dt, echo, controls = true) {
    if (controls) { player.applyInput(input, dt); this.body.setLinvel(player.linearVelocity, true); this.body.setAngvel(player.angularVelocity, true); }
    this.setEcho(echo); this.world.timestep = dt; this.world.step(this.events); this.sync(player);
    let impact = 0;
    this.events.drainContactForceEvents(event => { if (event.collider1() === this.collider.handle || event.collider2() === this.collider.handle) impact = Math.max(impact, event.totalForceMagnitude() * dt / this.body.mass()); });
    const contacts = new Set();
    this.world.contactPairsWith(this.collider, other => this.world.contactPair(this.collider, other, manifold => { if (manifold.numSolverContacts() > 0) contacts.add(this.tags.get(other.handle)); }));
    const floor = terrainSurfaceHeight(player.position.x, player.position.z, this.track);
    const extentY = Math.abs(rotateVector({ x: VEHICLE.halfWidth, y: 0, z: 0 }, player.rotation).y) + Math.abs(rotateVector({ x: 0, y: VEHICLE.halfHeight, z: 0 }, player.rotation).y) + Math.abs(rotateVector({ x: 0, y: 0, z: VEHICLE.halfLength }, player.rotation).y);
    return { impact, contacts, water: floor < WATER_LEVEL && player.position.y - extentY <= WATER_LEVEL };
  }
  sink() { this.collider.setEnabled(false); this.body.setGravityScale(0.05, true); }
  dispose() { this.events.free(); this.world.free(); }
}
