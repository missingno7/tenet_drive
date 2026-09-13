import { PHYSICS, clamp } from './config.js';
import { WATER_LEVEL, TERRAIN, terrainSurfaceHeight } from './surfaces.js';
import { rotateVector } from './vehicle.js';
/** A fluid volume above submerged terrain, never a permanent state on a body. */
export class WaterVolume {
  constructor(track) { this.track = track; }
  contains(p) {
    return Math.abs(p.x) < TERRAIN.width / 2 && Math.abs(p.z - TERRAIN.centerZ) < TERRAIN.depth / 2 && p.y < WATER_LEVEL && p.y > terrainSurfaceHeight(p.x, p.z, this.track);
  }
  apply(body, half, dt, buoyancy = 0.72) {
    const origin = body.translation(), rotation = body.rotation(); let submerged = 0;
    if (origin.y - Math.hypot(half.x, half.y, half.z) >= WATER_LEVEL) return 0;
    const mass = body.mass(), count = 24;
    // Volume quadrature supplies distributed buoyancy and drag (including torque).
    for (const x of [-0.65, 0.65]) for (const y of [-0.75, -0.25, 0.25, 0.75]) for (const z of [-0.7, 0, 0.7]) {
      const v = rotateVector({ x: x * half.x, y: y * half.y, z: z * half.z }, rotation);
      const point = { x: origin.x + v.x, y: origin.y + v.y, z: origin.z + v.z };
      if (!this.contains(point)) continue;
      submerged++;
      const velocity = body.velocityAtPoint(point), damping = 1 - Math.exp(-2.8 * dt);
      body.applyImpulseAtPoint({ x: -velocity.x * mass / count * damping, y: mass / count * (PHYSICS.gravity * buoyancy * dt - velocity.y * damping), z: -velocity.z * mass / count * damping }, point, true);
    }
    return clamp(submerged / count, 0, 1);
  }
}
