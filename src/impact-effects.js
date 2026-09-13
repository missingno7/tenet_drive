import * as THREE from 'three';
import { WATER_LEVEL } from './surfaces.js';
export class ImpactEffects {
  constructor(scene) {
    this.bits = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ transparent: true, opacity: 1 }), 90);
    this.smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x45484a, transparent: true, opacity: 0.4, depthWrite: false }), 15);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 4, 64), new THREE.MeshBasicMaterial({ color: 0xbfeff4, transparent: true, opacity: 0.7, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.light = new THREE.PointLight(0xff6c20, 0, 20);
    this.dummy = new THREE.Object3D(); this.color = new THREE.Color();
    scene.add(this.bits, this.smoke, this.ring, this.light); this.update(null);
  }
  update(crash) {
    this.bits.visible = !!crash; this.smoke.visible = !!crash && crash.kind !== 'water'; this.ring.visible = !!crash && crash.kind === 'water'; this.light.intensity = 0;
    if (!crash) return;
    const t = crash.age, p = crash.position, water = crash.kind === 'water';
    for (let i = 0; i < 90; i++) {
      const angle = i * 2.39996, spread = 2 + (i * 19 % 43) / 8, rise = 2 + (i * 7 % 19) / 4;
      this.dummy.position.set(p.x + Math.cos(angle) * spread * t, p.y + rise * t - (water ? 7 : 9) * t * t, p.z + Math.sin(angle) * spread * t);
      this.dummy.rotation.set(i + t * 3, t * 5, i * 0.4); this.dummy.scale.setScalar((water ? 0.08 : 0.13) * Math.max(0.05, 1 - t / 2.2)); this.dummy.updateMatrix(); this.bits.setMatrixAt(i, this.dummy.matrix);
      this.color.set(water ? (i % 3 ? 0xa8e9f0 : 0xe9fcff) : t < 0.35 ? (i % 3 ? 0xff742b : 0xffd45e) : 0x635249); this.bits.setColorAt(i, this.color);
    }
    this.bits.instanceMatrix.needsUpdate = true; this.bits.instanceColor.needsUpdate = true; this.bits.material.opacity = Math.max(0, 1 - t / 2.2); this.bits.computeBoundingSphere();
    if (water) { this.ring.position.set(p.x, WATER_LEVEL + 0.025, p.z); this.ring.scale.setScalar(0.2 + t * 4); this.ring.material.opacity = Math.max(0, 0.7 - t * 0.32); }
    else {
      for (let i = 0; i < 15; i++) {
        this.dummy.position.set(p.x + Math.sin(i * 3) * t, p.y + 0.4 + t * (1 + i % 3), p.z + Math.cos(i * 2.8) * t); this.dummy.scale.setScalar(0.2 + t * (0.55 + i / 30)); this.dummy.updateMatrix(); this.smoke.setMatrixAt(i, this.dummy.matrix);
      }
      this.smoke.instanceMatrix.needsUpdate = true; this.smoke.computeBoundingSphere(); this.smoke.material.opacity = Math.max(0, 0.36 - t * 0.12);
      this.light.position.set(p.x, p.y + 1, p.z); this.light.intensity = Math.max(0, 25 * (1 - t * 3));
    }
  }
}
