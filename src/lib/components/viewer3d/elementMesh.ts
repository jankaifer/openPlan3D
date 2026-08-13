import * as THREE from 'three';
import type { Beam, Roof, Slab } from '$lib/models/types';
import { buildRoofMesh } from '$lib/utils/roofGeometry';

/**
 * Render adapter: structural elements (beams, slabs, roofs) → three.js meshes
 * in plan-cm world space (plan X → world X, plan Y → world Z, height → Y).
 * Geometry math lives in $lib/utils/roofGeometry; this file only converts.
 */

export function buildBeamMesh(beam: Beam): THREE.Mesh {
  const len = Math.hypot(beam.end.x - beam.start.x, beam.end.y - beam.start.y);
  const geo = new THREE.BoxGeometry(Math.max(len, 1), beam.depth, beam.width);
  const mat = new THREE.MeshStandardMaterial({ color: beam.color, roughness: 0.8 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(
    (beam.start.x + beam.end.x) / 2,
    beam.elevation + beam.depth / 2,
    (beam.start.y + beam.end.y) / 2
  );
  mesh.rotation.y = -Math.atan2(beam.end.y - beam.start.y, beam.end.x - beam.start.x);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildSlabMesh(slab: Slab): THREE.Mesh | null {
  if (slab.outline.length < 3) return null;
  const shape = new THREE.Shape(slab.outline.map((p) => new THREE.Vector2(p.x, p.y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: slab.thickness, bevelEnabled: false });
  // Shape XY is plan XY; rotate so extrusion (local +Z) points down from the
  // top surface: plan Y → world Z, extrude depth → -Y.
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: slab.color, roughness: 0.9 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = slab.elevation;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildRoofMesh3d(roof: Roof): THREE.Mesh | null {
  const data = buildRoofMesh(roof);
  if (!data) return null;
  const n = data.vertices.length / 3;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = data.vertices[i * 3];         // plan X → world X
    positions[i * 3 + 1] = data.vertices[i * 3 + 2] + roof.baseElevation; // z up → world Y
    positions[i * 3 + 2] = data.vertices[i * 3 + 1]; // plan Y → world Z
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(data.indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: roof.color, roughness: 0.85, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** All structural meshes of a floor, added to `group`. */
export function addStructuralMeshes(group: THREE.Group, floor: { beams?: Beam[]; slabs?: Slab[]; roofs?: Roof[] }) {
  for (const b of floor.beams ?? []) group.add(buildBeamMesh(b));
  for (const s of floor.slabs ?? []) {
    const m = buildSlabMesh(s);
    if (m) group.add(m);
  }
  for (const r of floor.roofs ?? []) {
    const m = buildRoofMesh3d(r);
    if (m) group.add(m);
  }
}
