import { VEHICLE, clamp } from './config.js';
export function rotationFromAngles(yaw, pitch = 0) {
  const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
  return { x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx };
}
export function yawFromRotation(q) { return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)); }
export function rotateVector(v, q) {
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + q.y * tz - q.z * ty, y: v.y + q.w * ty + q.z * tx - q.x * tz, z: v.z + q.w * tz + q.x * ty - q.y * tx };
}
/** Arcade traction and steering only. Rapier owns gravity, pose and all contacts. */
export class VehicleController {
  constructor(x, z, yaw, track) {
    this.position = { x, y: track.height(z) + VEHICLE.rideHeight, z };
    this.linearVelocity = { x: 0, y: 0, z: 0 }; this.angularVelocity = { x: 0, y: 0, z: 0 };
    this.yaw = yaw; this.rotation = rotationFromAngles(yaw); this.grounded = false; this.drifting = false;
  }
  get speed() { return Math.hypot(this.linearVelocity.x, this.linearVelocity.z); }
  get upright() { return rotateVector({ x: 0, y: 1, z: 0 }, this.rotation).y; }
  applyInput(input, dt) {
    this.drifting = false;
    if (!this.grounded || this.upright < 0.5) return;
    const v = this.linearVelocity, forward = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }, side = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
    let longitudinal = v.x * forward.x + v.z * forward.z;
    const lateral = v.x * side.x + v.z * side.z;
    let force = input.throttle * VEHICLE.acceleration;
    if (input.brake) force -= longitudinal > 0.6 ? VEHICLE.braking : VEHICLE.reverseAcceleration;
    if (input.handbrake) force -= Math.sign(longitudinal) * 5;
    longitudinal = clamp(longitudinal + (force - longitudinal * VEHICLE.drag) * dt, -VEHICLE.reverseSpeed, VEHICLE.maxSpeed);
    const sideSpeed = lateral * Math.exp(-(input.handbrake ? VEHICLE.driftGrip : VEHICLE.grip) * dt);
    v.x = forward.x * longitudinal + side.x * sideSpeed; v.z = forward.z * longitudinal + side.z * sideSpeed;
    this.drifting = this.speed > 8 && (input.handbrake || Math.abs(lateral) > 5);
    const steering = input.steer * Math.sign(longitudinal || 1) * Math.min(Math.abs(longitudinal) / 7, 1) * (1.65 - clamp(this.speed / 90, 0, 0.65)) * (input.handbrake ? 1.45 : 1);
    this.angularVelocity.y += (steering - this.angularVelocity.y) * (1 - Math.exp(-7 * dt));
  }
}
