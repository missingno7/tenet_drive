import RAPIER from './rapier.js';
import { VEHICLE } from './config.js';
const bodyShape = new RAPIER.RoundCuboid(VEHICLE.halfWidth - 0.12, VEHICLE.halfHeight - 0.12, VEHICLE.halfLength - 0.12, 0.12);
/** Read-only 3D clearance, including rolled cars. PhysicsWorld handles response. */
export function contactBetween(player, echo) {
  const contact = bodyShape.contactShape(player.position, player.rotation, bodyShape, echo.position, echo.rotation, 2000);
  return { colliding: !!contact && contact.distance <= 0, gap: contact ? Math.max(0, contact.distance) : Infinity };
}
