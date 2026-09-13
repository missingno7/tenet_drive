import { SCORING, clamp } from './config.js';
export class ScoringSystem {
  constructor() { this.score = 0; this.multiplier = 0; this.maxMultiplier = 0; this.bestGap = Infinity; this.sustain = 0; this.cooldown = 0; this.gap = Infinity; this.event = ''; }
  step(dt, player, echo, contact) {
    this.event = '';
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.gap = contact?.gap ?? Infinity;
    this.multiplier = 0;
    if (contact?.colliding) { this.cooldown = SCORING.collisionCooldown; this.sustain = 0; return; }
    const speed = Math.hypot(player.linearVelocity.x, player.linearVelocity.z);
    if (!echo || this.gap > 5 || speed < SCORING.minimumSpeed || this.cooldown > 0) { this.sustain = 0; return; }
    this.multiplier = SCORING.bands.find(([distance]) => this.gap < distance)?.[1] ?? 0;
    if (!this.multiplier) { this.sustain = 0; return; }
    const relativeSpeed = Math.hypot(player.linearVelocity.x - echo.linearVelocity.x, player.linearVelocity.y - echo.linearVelocity.y, player.linearVelocity.z - echo.linearVelocity.z);
    this.sustain += dt;
    const speedFactor = clamp(speed / 22, 0.25, 2.5) * (1 + clamp(relativeSpeed / 45, 0, 2));
    const timeFactor = 1 + Math.min(this.sustain * SCORING.sustainGrowth, SCORING.maxSustain - 1);
    this.score += SCORING.pointsPerSecond * this.multiplier * speedFactor * timeFactor * dt;
    if (this.multiplier > this.maxMultiplier && this.multiplier >= 8) this.event = this.multiplier === 16 ? 'PARADOX!' : 'TEMPORAL NEAR MISS';
    this.maxMultiplier = Math.max(this.maxMultiplier, this.multiplier);
    this.bestGap = Math.min(this.bestGap, this.gap);
  }
}
