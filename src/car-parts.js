import { VEHICLE } from './config.js';
export const CAR_PARTS = Object.freeze([
  { id: 'hood', size: [1.76, 0.09, 1.15], position: [0, 0.17, 1.22], material: 'paint', mass: 18, threshold: 15 },
  { id: 'front-bumper', size: [1.91, 0.22, 0.18], position: [0, -0.18, 1.98], material: 'dark', mass: 12, threshold: 14 },
  { id: 'rear-bumper', size: [1.91, 0.22, 0.18], position: [0, -0.18, -1.98], material: 'dark', mass: 12, threshold: 14 },
  { id: 'spoiler', size: [1.96, 0.09, 0.4], position: [0, 0.48, -1.63], material: 'dark', mass: 8, threshold: 16 },
  { id: 'roof', size: [1.52, 0.06, 1.32], position: [0, 0.67, -0.4], material: 'paint', mass: 22, threshold: 22 },
]);
export const WHEELS = Object.freeze([-VEHICLE.wheelHalfTrack, VEHICLE.wheelHalfTrack].flatMap(x => [VEHICLE.rearAxle, VEHICLE.frontAxle].map(z => ({ x, y: 0.05, z }))));
export const SUSPENSION = Object.freeze({ rest: 0.4, radius: 0.39, travel: 0.2, stiffness: 55, compression: 4.5, relaxation: 5, maxForce: 12000, grip: 1.5 });
export const GROUPS = Object.freeze({ solid: 0x0001ffff, car: 0x0002000f, debris: 0x0004000d, detached: 0x0004000f, echo: 0x00080007 });
