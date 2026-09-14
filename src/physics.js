import RAPIER from './rapier.js';
import { PHYSICS, VEHICLE, clamp } from './config.js';
import { roadCollisionMeshes, terrainCollisionMeshes } from './surfaces.js';
import { yawFromRotation, rotateVector } from './vehicle.js';
import { infrastructure } from './infrastructure.js';
import { WaterVolume } from './water.js';
import { CAR_PARTS, WHEELS, SUSPENSION, GROUPS } from './car-parts.js';
import { sceneryLayout, ROCK_VERTICES } from './scenery-layout.js';
import { rotationFromAngles, rotationFromEuler } from './vehicle.js';

const zero = { x: 0, y: 0, z: 0 }, identity = { x: 0, y: 0, z: 0, w: 1 };
export class PhysicsWorld {
  constructor(track, { terrain = true, scenery = terrain, roadSectionLength = 64, terrainSectionSize = 128 } = {}) {
    this.track = track; this.world = new RAPIER.World({ x: 0, y: -PHYSICS.gravity, z: 0 }); this.tags = new Map(); this.solids = [];
    this.world.numSolverIterations = 8; this.world.integrationParameters.maxCcdSubsteps = 4;
    this.events = new RAPIER.EventQueue(true); this.water = new WaterVolume(track); this.debris = [];
    for (const road of roadCollisionMeshes(track, roadSectionLength)) this.addStatic(RAPIER.ColliderDesc.trimesh(road.vertices, road.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.75), 'road');
    if (terrain) for (const ground of terrainCollisionMeshes(track, terrainSectionSize)) this.addStatic(RAPIER.ColliderDesc.trimesh(ground.vertices, ground.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.8), 'terrain');
    for (const object of infrastructure(track)) this.addSolid(object);
    if (scenery) {
      const layout = sceneryLayout(track);
      for (const b of layout.buildings) for (const [width, height, depth, y] of [[b.width, b.height, b.depth, b.base + b.height / 2], [b.width + 2, 3, b.depth + 2, b.base - 0.5], [b.width * 0.55, 2.4, b.depth * 0.55, b.base + b.height + 1.2]]) this.addSolid({ tag: 'building', size: [width, height, depth], position: [b.x, y, b.z], rotation: rotationFromAngles(b.yaw) });
      for (const t of layout.trees) this.addStatic(RAPIER.ColliderDesc.cylinder(t.height * 0.25, 0.23).setTranslation(t.x, t.y + t.height * 0.25, t.z).setFriction(0.7), 'tree');
      for (const r of layout.rocks) this.addStatic(RAPIER.ColliderDesc.convexHull(new Float32Array(ROCK_VERTICES.map((v, i) => v * r.size * [1.4, 0.8, 1][i % 3]))).setTranslation(r.x, r.y, r.z).setRotation(rotationFromEuler(...r.rotation)).setFriction(0.7), 'rock');
    }
  }
  addStatic(desc, tag) { const collider = this.world.createCollider(desc.setCollisionGroups(GROUPS.solid)); this.tags.set(collider.handle, tag); return collider; }
  addSolid(object) {
    const { size, position, tag } = object;
    const desc = RAPIER.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setTranslation(...position).setFriction(0.65);
    if (object.rotation) desc.setRotation(object.rotation);
    const collider = this.addStatic(desc, tag); this.solids.push({ ...object, collider }); return collider;
  }
  addBox(x, y, z, px, py, pz, tag) { return this.addSolid({ size: [x * 2, y * 2, z * 2], position: [px, py, pz], tag }); }
  reset(player, echo) {
    if (this.vehicle) this.world.removeVehicleController(this.vehicle);
    if (this.body) this.world.removeRigidBody(this.body);
    if (this.echoBody) { this.tags.delete(this.echoCollider.handle); this.world.removeRigidBody(this.echoBody); }
    for (const part of this.debris) this.world.removeRigidBody(part.body);
    this.debris = []; this.detached = new Set(); this.parts = new Map(); this.echoBody = null; this.submerged = 0; this.damageCooldown = 0; this.steering = 0;
    this.body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(player.position.x, player.position.y, player.position.z).setRotation(player.rotation).setCcdEnabled(true).setAngularDamping(0.15).setCanSleep(false).setAdditionalMassProperties(828, { x: 0, y: -0.32, z: 0 }, { x: 1300, y: 1600, z: 550 }, identity));
    this.carColliders = [];
    const attach = desc => {
      const collider = this.world.createCollider(desc.setDensity(0).setCollisionGroups(GROUPS.car).setFriction(0.25).setRestitution(0.05).setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS), this.body);
      this.carColliders.push(collider); return collider;
    };
    this.collider = attach(RAPIER.ColliderDesc.roundCuboid(0.84, 0.16, 1.77, 0.08).setTranslation(0, -0.1, 0));
    attach(RAPIER.ColliderDesc.roundCuboid(0.69, 0.22, 0.78, 0.04).setTranslation(0, 0.39, -0.26));
    for (const part of CAR_PARTS) {
      const collider = attach(RAPIER.ColliderDesc.cuboid(...part.size.map(v => v / 2)).setTranslation(...part.position));
      collider.setMass(part.mass); this.parts.set(part.id, collider);
    }
    this.vehicle = this.world.createVehicleController(this.body); this.vehicle.indexUpAxis = 1; this.vehicle.setIndexForwardAxis = 2;
    this.wheelColliders = [];
    for (const [i, connection] of WHEELS.entries()) {
      this.vehicle.addWheel(connection, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, SUSPENSION.rest, SUSPENSION.radius);
      this.vehicle.setWheelMaxSuspensionTravel(i, SUSPENSION.travel); this.vehicle.setWheelSuspensionStiffness(i, SUSPENSION.stiffness);
      this.vehicle.setWheelSuspensionCompression(i, SUSPENSION.compression); this.vehicle.setWheelSuspensionRelaxation(i, SUSPENSION.relaxation);
      this.vehicle.setWheelMaxSuspensionForce(i, SUSPENSION.maxForce); this.vehicle.setWheelFrictionSlip(i, SUSPENSION.grip);
      this.vehicle.setWheelSideFrictionStiffness(i, 1);
      // Side/underside tire contact remains solid when a ray misses the deck.
      this.wheelColliders.push(attach(RAPIER.ColliderDesc.cylinder(0.12, SUSPENSION.radius - 0.03).setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }).setTranslation(connection.x, -0.3, connection.z)));
    }
    this.body.recomputeMassPropertiesFromColliders();
    this.body.setLinvel(player.linearVelocity, true); this.body.setAngvel(player.angularVelocity, true);
    this.setEcho(echo, true); this.world.updateSceneQueries(); this.sync(player);
  }
  setEcho(state, initial = false) {
    if (!state) { if (this.echoBody) { this.tags.delete(this.echoCollider.handle); this.world.removeRigidBody(this.echoBody); this.echoBody = null; } return; }
    if (!this.echoBody) {
      const desc = state.frozen ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.kinematicPositionBased();
      this.echoBody = this.world.createRigidBody(desc.setTranslation(state.position.x, state.position.y, state.position.z).setRotation(state.rotation));
      this.echoCollider = this.world.createCollider(RAPIER.ColliderDesc.roundCuboid(VEHICLE.halfWidth - 0.12, VEHICLE.halfHeight - 0.12, VEHICLE.halfLength - 0.12, 0.12).setCollisionGroups(GROUPS.echo).setFriction(0.25).setRestitution(0.15), this.echoBody);
      this.tags.set(this.echoCollider.handle, 'echo');
    }
    if (initial) { this.echoBody.setTranslation(state.position, false); this.echoBody.setRotation(state.rotation, false); }
    if (state.frozen) {
      if (!this.echoBody.isFixed()) this.echoBody.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      return;
    }
    if (this.echoBody.isFixed()) this.echoBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    this.echoBody.setNextKinematicTranslation(state.position); this.echoBody.setNextKinematicRotation(state.rotation);
  }
  teleport(player, position, rotation = player.rotation, velocity = zero, angular = zero) {
    this.body.setTranslation(position, true); this.body.setRotation(rotation, true); this.body.setLinvel(velocity, true); this.body.setAngvel(angular, true); this.sync(player);
  }
  sync(player) {
    player.detachedParts = [...this.detached];
    player.position = { ...this.body.translation() }; player.rotation = { ...this.body.rotation() };
    player.linearVelocity = { ...this.body.linvel() }; player.angularVelocity = { ...this.body.angvel() }; player.yaw = yawFromRotation(player.rotation);
    player.grounded = WHEELS.some((_, i) => this.vehicle.wheelIsInContact(i));
    player.wheels = WHEELS.map((p, i) => ({ y: p.y - (this.vehicle.wheelSuspensionLength(i) ?? SUSPENSION.rest), steer: this.vehicle.wheelSteering(i) ?? 0, spin: this.vehicle.wheelRotation(i) ?? 0 }));
  }
  drive(input, dt, controls) {
    const speed = this.vehicle.currentVehicleSpeed(), mass = this.body.mass();
    const throttle = controls ? input.throttle : 0, brake = controls ? input.brake : 0;
    const maxSteer = 0.48 / (1 + Math.abs(speed) / 45);
    this.steering += (maxSteer * (controls ? input.steer : 0) - this.steering) * (1 - Math.exp(-8 * dt));
    const reverse = brake > 0 && speed < 0.6;
    const engine = reverse ? -brake * VEHICLE.reverseAcceleration * mass : throttle * VEHICLE.acceleration * mass * clamp((VEHICLE.maxSpeed - speed) / 15, 0, 1);
    for (let i = 0; i < WHEELS.length; i++) {
      const front = WHEELS[i].z > 0;
      this.vehicle.setWheelSteering(i, front ? this.steering : 0);
      this.vehicle.setWheelEngineForce(i, (reverse && speed < -VEHICLE.reverseSpeed ? 0 : engine) / 4);
      this.vehicle.setWheelBrake(i, ((reverse ? 0 : brake) * VEHICLE.braking + (controls && input.handbrake && !front ? 30 : 0)) * mass * dt / 4);
      this.vehicle.setWheelFrictionSlip(i, controls && input.handbrake && !front ? 0.65 : SUSPENSION.grip);
    }
    // Real tire impulses and spring forces, including when the engine is off.
    this.vehicle.updateVehicle(dt, undefined, undefined, c => c.parent()?.handle !== this.body.handle && this.tags.has(c.handle));
    for (let i = 0; i < WHEELS.length; i++) this.wheelColliders[i].setTranslationWrtParent({ x: WHEELS[i].x, y: WHEELS[i].y - this.vehicle.wheelSuspensionLength(i), z: WHEELS[i].z });
    const v = this.body.linvel(); this.body.addForce({ x: -v.x * mass * VEHICLE.drag, y: 0, z: -v.z * mass * VEHICLE.drag }, true);
  }
  breakParts(impact, point) {
    if (this.damageCooldown > 0 || impact < 7) return;
    const candidates = CAR_PARTS.filter(p => !this.detached.has(p.id) && impact >= p.threshold).map(part => {
      const offset = rotateVector({ x: part.position[0], y: part.position[1], z: part.position[2] }, this.body.rotation());
      const p = this.body.translation(), position = { x: p.x + offset.x, y: p.y + offset.y, z: p.z + offset.z };
      return { part, position, distance: Math.hypot(position.x - point.x, position.y - point.y, position.z - point.z) };
    }).sort((a, b) => a.distance - b.distance).slice(0, impact > 18 ? 3 : 1);
    for (const { part, position } of candidates) {
      const attached = this.parts.get(part.id); this.carColliders = this.carColliders.filter(c => c !== attached); this.world.removeCollider(attached, true); this.detached.add(part.id);
      // A failed attachment stops transmitting the chassis impact to this part.
      // Preserve the part's incoming momentum and apply the balancing impulse
      // to the remaining chassis, rather than launching it with a random kick.
      const after = this.body.velocityAtPoint(position), velocity = this.incomingParts?.get(part.id) ?? after, angular = this.body.angvel();
      this.body.applyImpulseAtPoint({ x: part.mass * (after.x - velocity.x), y: part.mass * (after.y - velocity.y), z: part.mass * (after.z - velocity.z) }, position, true);
      const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(position.x, position.y, position.z).setRotation(this.body.rotation()).setLinvel(velocity.x, velocity.y, velocity.z).setAngvel(angular).setCcdEnabled(true));
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(...part.size.map(v => v / 2)).setMass(part.mass).setFriction(0.65).setRestitution(0.12).setCollisionGroups(GROUPS.debris), body);
      this.debris.push({ id: part.id, body, age: 0, half: { x: part.size[0] / 2, y: part.size[1] / 2, z: part.size[2] / 2 } });
      body.recomputeMassPropertiesFromColliders();
    }
    this.body.recomputeMassPropertiesFromColliders();
    this.damageCooldown = 0.18;
  }
  step(player, input, dt, echo, controls = true) {
    this.body.resetForces(false); this.body.resetTorques(false);
    this.drive(input, dt, controls);
    this.submerged = this.water.apply(this.body, { x: 0.95, y: 0.62, z: 2 }, dt);
    for (const part of this.debris) {
      part.age += dt;
      // Allow adjacent attached meshes to separate before self-collision.
      if (part.age >= 0.08 && part.age - dt < 0.08) part.body.collider(0).setCollisionGroups(GROUPS.detached);
      this.water.apply(part.body, part.half, dt);
    }
    this.incomingParts = new Map();
    const origin = this.body.translation(), rotation = this.body.rotation();
    for (const part of CAR_PARTS) if (!this.detached.has(part.id)) {
      const p = rotateVector({ x: part.position[0], y: part.position[1], z: part.position[2] }, rotation);
      this.incomingParts.set(part.id, this.body.velocityAtPoint({ x: origin.x + p.x, y: origin.y + p.y, z: origin.z + p.z }));
    }
    const incoming = { center: this.body.worldCom(), velocity: this.body.linvel(), angular: this.body.angvel() };
    this.setEcho(echo); this.world.timestep = dt; this.world.step(this.events); this.sync(player);
    this.damageCooldown = Math.max(0, this.damageCooldown - dt);
    const own = new Set(this.carColliders.map(c => c.handle)); let impact = 0, impactOther = null;
    this.events.drainContactForceEvents(event => {
      if (!own.has(event.collider1()) && !own.has(event.collider2())) return;
      const value = event.totalForceMagnitude() * dt / this.body.mass();
      if (value > impact) { impact = value; impactOther = this.world.getCollider(own.has(event.collider1()) ? event.collider2() : event.collider1()); }
    });
    const contacts = new Set(); let point = player.position, closingSpeed = 0;
    for (const collider of this.carColliders) this.world.contactPairsWith(collider, other => this.world.contactPair(collider, other, manifold => {
      if (manifold.numSolverContacts() > 0) {
        contacts.add(this.tags.get(other.handle));
        if (other.handle === impactOther?.handle) {
          point = manifold.solverContactPoint(0);
          const n = manifold.normal(), r = { x: point.x - incoming.center.x, y: point.y - incoming.center.y, z: point.z - incoming.center.z }, v = incoming.velocity, w = incoming.angular;
          const otherVelocity = other.parent()?.velocityAtPoint(point) ?? zero;
          closingSpeed = Math.max(closingSpeed, Math.abs((v.x + w.y * r.z - w.z * r.y - otherVelocity.x) * n.x + (v.y + w.z * r.x - w.x * r.z - otherVelocity.y) * n.y + (v.z + w.x * r.y - w.y * r.x - otherVelocity.z) * n.z));
        }
      }
    }));
    // Solver stabilization impulses are not impact energy. Bound the damage
    // signal by actual incoming speed normal to the contacted surface.
    impact = Math.min(impact, closingSpeed);
    this.breakParts(impact, point);
    player.detachedParts = [...this.detached];
    player.drifting = player.grounded && player.speed > 8 && !!input.handbrake;
    return { impact, contacts, water: this.submerged > 0, submerged: this.submerged, point };
  }
  dispose() { this.events.free(); this.world.free(); }
}
