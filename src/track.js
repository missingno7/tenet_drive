import { clamp, lerp } from './config.js';

/** One source of truth for road meshes, support queries, checkpoints and map. */
export class TrackManager {
  constructor() {
    this.length = 620;
    this.a = 12;
    this.b = 608;
    this.nodes = [[0, 0], [65, 0], [115, 20], [175, 20], [230, -6], [350, -6], [405, -25], [465, -25], [535, 4], [620, 4]];
    this.checkpoints = [80, 185, 270, 370, 485, 555];
    this.segments = this.buildSegments();
    this.bollards = [];
    for (let z = 0; z <= this.length; z += 28) for (const side of [-1, 1]) {
      this.bollards.push({ ...this.roadsidePlacement(z, side, 0.1, 0.1, 0.3), side });
    }
    this.signs = [[105, '02 / THE NEEDLE'], [226, '03 / SPLIT DECISION'], [391, '04 / AIR GAP'], [490, '05 / CLOSE QUARTERS']].map(([z, text]) => ({ ...this.roadsidePlacement(z, -1, 4.5, 0.15, 1), text, width: 9, height: 1.6 }));
  }
  center(z) {
    z = clamp(z, 0, this.length);
    for (let i = 1; i < this.nodes.length; i++) {
      const [b, x1] = this.nodes[i], [a, x0] = this.nodes[i - 1];
      if (z <= b) { const t = (z - a) / (b - a); return lerp(x0, x1, t * t * (3 - 2 * t)); }
    }
    return 4;
  }
  width(z) {
    if (z >= 125 && z <= 175) return 6.8;
    if (z > 110 && z < 125) return lerp(19, 6.8, (z - 110) / 15);
    if (z > 175 && z < 195) return lerp(6.8, 19, (z - 175) / 20);
    return lerp(19, 15, clamp((z - 490) / 10, 0, 1));
  }
  branchOffset(z) {
    return z >= 240 && z <= 355 ? 10.5 * Math.sin(Math.PI * (z - 240) / 115) ** 2 : 0;
  }
  profileLanes(z) {
    const c = this.center(z);
    if (z > 230 && z < 365) {
      const o = this.branchOffset(z);
      const w = z < 240 ? lerp(19, 8, (z - 230) / 10) : z > 355 ? lerp(8, 19, (z - 355) / 10) : 8;
      return [{ center: c - o, width: w, branch: -1 }, { center: c + o, width: w, branch: 1 }];
    }
    return [{ center: c, width: this.width(z), branch: 0 }];
  }
  buildSegments() {
    // Include every profile breakpoint, then split exactly where the branches
    // separate or rejoin. Each resulting quad is shared by graphics and physics.
    const knots = [...new Set([...Array.from({ length: 311 }, (_, i) => i * 2), ...this.nodes.map(n => n[0]), 110, 125, 175, 195, 230, 240, 355, 365, 410, 428, 446, 490, 500])].sort((a, b) => a - b);
    const segments = [];
    for (let i = 0; i < knots.length - 1; i++) {
      const z0 = knots[i], z1 = knots[i + 1];
      const a = this.profileLanes(z0), b = this.profileLanes(z1);
      const lanes = Array.from({ length: Math.max(a.length, b.length) }, (_, j) => {
        const start = a[Math.min(j, a.length - 1)], end = b[Math.min(j, b.length - 1)];
        return { left0: start.center - start.width / 2, right0: start.center + start.width / 2, left1: end.center - end.width / 2, right1: end.center + end.width / 2 };
      });
      const cuts = [0, 1];
      if (lanes.length === 2) {
        const g0 = lanes[1].left0 - lanes[0].right0, g1 = lanes[1].left1 - lanes[0].right1;
        if (g0 * g1 < 0) cuts.splice(1, 0, g0 / (g0 - g1));
      }
      for (let j = 0; j < cuts.length - 1; j++) {
        const t0 = cuts[j], t1 = cuts[j + 1];
        let quads = lanes.map(l => ({ left0: lerp(l.left0, l.left1, t0), right0: lerp(l.right0, l.right1, t0), left1: lerp(l.left0, l.left1, t1), right1: lerp(l.right0, l.right1, t1) }));
        if (quads.length === 2 && (quads[1].left0 + quads[1].left1) / 2 <= (quads[0].right0 + quads[0].right1) / 2) {
          quads = [{ left0: quads[0].left0, right0: quads[1].right0, left1: quads[0].left1, right1: quads[1].right1 }];
        }
        segments.push({ z0: lerp(z0, z1, t0), z1: lerp(z0, z1, t1), y0: lerp(this.height(z0), this.height(z1), t0), y1: lerp(this.height(z0), this.height(z1), t1), lanes: quads });
      }
    }
    return segments;
  }
  segmentAt(z) {
    if (z < 0 || z > this.length) return null;
    let lo = 0, hi = this.segments.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.segments[mid].z1 < z) lo = mid + 1; else hi = mid; }
    return this.segments[lo];
  }
  lanes(z) {
    const segment = this.segmentAt(z);
    if (!segment) return [];
    const t = (z - segment.z0) / (segment.z1 - segment.z0);
    return segment.lanes.map(l => {
      const left = lerp(l.left0, l.left1, t), right = lerp(l.right0, l.right1, t);
      return { left, right, center: (left + right) / 2, width: right - left };
    });
  }
  roadsidePlacement(z, side, halfWidth, halfDepth, margin) {
    const start = clamp(z - halfDepth, 0, this.length), end = clamp(z + halfDepth, 0, this.length);
    const samples = [start, end, ...this.segments.filter(s => s.z0 > start && s.z0 < end).map(s => s.z0)];
    const edges = samples.flatMap(s => this.lanes(s).map(l => side < 0 ? l.left : l.right));
    const edge = side < 0 ? Math.min(...edges) : Math.max(...edges);
    return { x: edge + side * (halfWidth + margin), z, y: this.height(z), halfWidth, halfDepth };
  }
  height(z) {
    // A symmetric 1:5 ramp works in both directions; the sharp crest launches the car.
    return 12 + (z >= 410 && z <= 446 ? 3.6 * (1 - Math.abs(z - 428) / 18) : 0);
  }
  slope(z) { return (this.height(z + 0.05) - this.height(z - 0.05)) / 0.1; }
  sample(x, z) {
    const segment = this.segmentAt(z);
    if (!segment) return null;
    const lane = this.lanes(z).find(l => x >= l.left - 1e-8 && x <= l.right + 1e-8);
    return lane ? { height: lerp(segment.y0, segment.y1, (z - segment.z0) / (segment.z1 - segment.z0)), slope: (segment.y1 - segment.y0) / (segment.z1 - segment.z0), lane } : null;
  }
  heading(z, direction = 1) {
    return Math.atan2(this.center(z + 0.5) - this.center(z - 0.5), 1) + (direction < 0 ? Math.PI : 0);
  }
  section(z) {
    if (z < 110) return '01 / OPEN ROAD';
    if (z < 195) return '02 / THE NEEDLE';
    if (z < 375) return '03 / SPLIT DECISION';
    if (z < 480) return '04 / AIR GAP';
    return '05 / CLOSE QUARTERS';
  }
}

export class CheckpointSystem {
  constructor(track, direction) {
    this.targets = direction > 0 ? [...track.checkpoints] : [...track.checkpoints].reverse();
    this.next = 0;
    this.direction = direction;
  }
  update(previous, current, supported) {
    const z = this.targets[this.next];
    if (supported && z !== undefined && (previous - z) * this.direction <= 0 && (current - z) * this.direction >= 0) this.next++;
  }
  get complete() { return this.next === this.targets.length; }
}
