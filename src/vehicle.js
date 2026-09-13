import { VEHICLE } from './config.js';
export function rotationFromAngles(yaw, pitch = 0) {
  const sy = Math.sin(yaw / 2), cy = Math.cos(yaw / 2), sx = Math.sin(pitch / 2), cx = Math.cos(pitch / 2);
  return { x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx };
}
export function yawFromRotation(q) { return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)); }
export function rotationFromEuler(x, y, z) {
  const a = Math.cos(x / 2), b = Math.cos(y / 2), c = Math.cos(z / 2), d = Math.sin(x / 2), e = Math.sin(y / 2), f = Math.sin(z / 2);
  return { x: d * b * c + a * e * f, y: a * e * c - d * b * f, z: a * b * f + d * e * c, w: a * b * c - d * e * f };
}
export function rotateVector(v, q) {
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + q.y * tz - q.z * ty, y: v.y + q.w * ty + q.z * tx - q.x * tz, z: v.z + q.w * tz + q.x * ty - q.y * tx };
}
/** Render/replay state read from Rapier; no independent motion integration. */
export class VehicleController {
  constructor(x, z, yaw, track) {
    this.position = { x, y: track.height(z) + VEHICLE.rideHeight, z };
    this.linearVelocity = { x: 0, y: 0, z: 0 }; this.angularVelocity = { x: 0, y: 0, z: 0 };
    this.yaw = yaw; this.rotation = rotationFromAngles(yaw); this.grounded = false; this.drifting = false;
  }
  get speed() { return Math.hypot(this.linearVelocity.x, this.linearVelocity.z); }
  get upright() { return rotateVector({ x: 0, y: 1, z: 0 }, this.rotation).y; }
}
