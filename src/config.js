export const PHYSICS = Object.freeze({ dt: 1 / 120, substeps: 2, maxFrameTime: 0.1, gravity: 22 });
export const VEHICLE = Object.freeze({ acceleration: 21, braking: 35, reverseAcceleration: 12, maxSpeed: 100, reverseSpeed: 12, drag: 0.17, halfWidth: 0.94, halfLength: 2.02, halfHeight: 0.62, rideHeight: 0.68, wheelHalfTrack: 0.96, frontAxle: 1.23, rearAxle: -1.2 });
export const SCORING = Object.freeze({ bands: [[0.25, 16], [0.5, 8], [1, 4], [2, 2], [5, 1]], pointsPerSecond: 32, minimumSpeed: 3, sustainGrowth: 0.75, maxSustain: 4, collisionCooldown: 0.55 });
export const RUN = Object.freeze({ maxTime: 180, stuckSeconds: 12, transitionSeconds: 2.5, failureSeconds: 1.1 });
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
