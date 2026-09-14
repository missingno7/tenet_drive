import * as THREE from 'three';

/** Batch immutable geometry by material and region, retaining local culling. */
export function batchStaticMeshes(scene, sectionSize = 64) {
  scene.updateMatrixWorld(true);
  const buckets = new Map(), sources = [];
  scene.traverse(mesh => {
    if (!mesh.isMesh || mesh.isInstancedMesh || !mesh.visible || mesh.name === 'river' || mesh.name === 'riverbank-terrain') return;
    const attributes = Object.keys(mesh.geometry.attributes).sort();
    if (attributes.some(key => !['position', 'normal', 'uv', 'color'].includes(key))) return;
    sources.push(mesh);
    const transformed = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const geometry = transformed.index ? transformed.toNonIndexed() : transformed;
    geometry.computeBoundingBox(); const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    const region = [center.x, center.z].map(v => Math.floor(v / sectionSize)).join(',');
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = Array.isArray(mesh.material) ? geometry.groups : [{ start: 0, count: geometry.attributes.position.count, materialIndex: 0 }];
    for (const group of groups) {
      const material = materials[group.materialIndex];
      const key = [region, material.uuid, mesh.castShadow, mesh.receiveShadow, attributes.join(',')].join('|');
      if (!buckets.has(key)) buckets.set(key, { material, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, attributes: Object.fromEntries(attributes.map(name => [name, { size: geometry.attributes[name].itemSize, values: [] }])) });
      const bucket = buckets.get(key);
      for (const name of attributes) {
        const attribute = geometry.attributes[name], target = bucket.attributes[name].values;
        for (let i = group.start * attribute.itemSize; i < (group.start + group.count) * attribute.itemSize; i++) target.push(attribute.array[i]);
      }
    }
    geometry.dispose(); if (geometry !== transformed) transformed.dispose();
  });
  for (const mesh of sources) mesh.removeFromParent();
  for (const bucket of buckets.values()) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(bucket.attributes)) geometry.setAttribute(name, new THREE.Float32BufferAttribute(attribute.values, attribute.size));
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, bucket.material); mesh.castShadow = bucket.castShadow; mesh.receiveShadow = bucket.receiveShadow; mesh.name = 'static-batch'; scene.add(mesh);
  }
  // All original static geometry is now represented in the batches.
  for (const geometry of new Set(sources.map(mesh => mesh.geometry))) geometry.dispose();
  return { sourceMeshes: sources.length, batches: buckets.size };
}
