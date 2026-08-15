import * as THREE from 'three';
import type { SiteConfig, TerrainModel } from '$lib/models/types';
import { planFromSjtsk } from '$lib/utils/geo';
import { siteClipSjtskRect } from '$lib/utils/siteClip';
import { buildTin, type Tin } from '$lib/utils/tin';

/**
 * Render adapter: TIN terrain (S-JTSK meters) → three.js geometry in the
 * viewer's plan-cm world (plan X → world X, plan Y → world Z, height → world Y
 * relative to the render origin's elevation). Pure conversion — all surface
 * math lives in $lib/utils/tin.
 */

export interface TerrainScene {
  tin: Tin;
  /** Plan-space cm triples aligned with tin point indices: [x, planY, hCm]. */
  plan: Float32Array;
  geometry: THREE.BufferGeometry;
}

/**
 * Default flat starter lattice. Georeferenced sites get a flat plot spanning
 * the whole property clip rectangle (so the basemap drape covers it);
 * un-georeferenced ones keep the generic 40 m plot around the origin.
 */
export function flatTerrainModel(site: SiteConfig): TerrainModel {
  const o = site.renderOrigin;
  const xyz: number[] = [];
  if (o.x !== 0 || o.y !== 0) {
    const r = siteClipSjtskRect();
    const step = 25;
    const cols = Math.ceil((r.maxX - r.minX) / step) + 1;
    const rows = Math.ceil((r.maxY - r.minY) / step) + 1;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        xyz.push(
          Math.min(r.minX + col * step, r.maxX),
          Math.min(r.minY + row * step, r.maxY),
          o.z
        );
      }
    }
    return { xyz };
  }
  for (let i = -20; i <= 20; i++)
    for (let j = -20; j <= 20; j++) xyz.push(o.x + i, o.y + j, o.z);
  return { xyz };
}

export function buildTerrainScene(model: TerrainModel, site: SiteConfig): TerrainScene | null {
  const tin = buildTin(model.xyz);
  if (!tin) return null;

  const n = tin.count;
  const plan = new Float32Array(n * 3);
  const positions = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = planFromSjtsk(site, model.xyz[i * 3], model.xyz[i * 3 + 1], model.xyz[i * 3 + 2]);
    plan[i * 3] = p.x;
    plan[i * 3 + 1] = p.y;
    plan[i * 3 + 2] = p.z!;
    positions[i * 3] = p.x;      // world X
    positions[i * 3 + 1] = p.z!; // world Y (height)
    positions[i * 3 + 2] = p.y;  // world Z
    uvs[i * 2] = p.x;
    uvs[i * 2 + 1] = p.y;
  }

  // Delaunator triangles wind clockwise in the (east, north) plane, which is
  // counterclockwise in the viewer's (X, Z=south) plane — already the upward-
  // facing front-face order after the axis swap; verify and flip defensively.
  let indices = Array.from(tin.triangles);
  {
    const [a, b, c] = indices;
    const ux = positions[b * 3] - positions[a * 3], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
    const vx = positions[c * 3] - positions[a * 3], vz = positions[c * 3 + 2] - positions[a * 3 + 2];
    const normalY = uz * vx - ux * vz;
    if (normalY < 0) {
      for (let t = 0; t < indices.length; t += 3) {
        const tmp = indices[t + 1];
        indices[t + 1] = indices[t + 2];
        indices[t + 2] = tmp;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return { tin, plan, geometry };
}
