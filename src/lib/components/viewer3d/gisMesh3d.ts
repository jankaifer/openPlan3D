import * as THREE from 'three';
import type { GisFeature, GisLayer, SiteConfig } from '$lib/models/types';
import { featurePlanVertices } from '$lib/utils/gis';
import type { Tin } from '$lib/utils/tin';

/**
 * Render adapter: GIS layers → three.js objects in the viewer's plan-cm world
 * (plan X → world X, plan Y → world Z, elevation cm → world Y). Buried
 * features (depth set) render as tubes/markers under the surface; surface
 * features sit slightly above the terrain so they stay visible.
 */

const SURFACE_LIFT = 6; // cm above terrain for surface features

function toWorld(v: { x: number; y: number; z: number }, lift: number): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.z + lift, v.y);
}

export function buildGisGroup(
  layers: GisLayer[],
  features: GisFeature[],
  site: SiteConfig,
  tin: Tin | null
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'gis';
  const layerById = new Map(layers.map((l) => [l.id, l]));

  for (const f of features) {
    const layer = layerById.get(f.layerId);
    if (!layer || !layer.visible || f.vertices.length === 0) continue;
    const color = new THREE.Color(layer.color);
    const lift = f.depth !== undefined ? 0 : SURFACE_LIFT;
    const verts = featurePlanVertices(f, site, tin).map((v) => toWorld(v, lift));

    if (f.kind === 'point') {
      for (const v of verts) {
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(10, 12, 8),
          new THREE.MeshBasicMaterial({ color })
        );
        marker.position.copy(v);
        group.add(marker);
        // Stake line up to the surface for buried points.
        if (f.depth !== undefined) {
          const top = v.clone().setY(v.y + f.depth + SURFACE_LIFT);
          const g = new THREE.BufferGeometry().setFromPoints([v, top]);
          group.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 })));
        }
      }
    } else if (verts.length >= 2) {
      // Lines and polygon outlines as tubes so they are visible at distance.
      const closed = f.kind === 'polygon';
      const curve = new THREE.CatmullRomCurve3(verts, closed, 'catmullrom', 0);
      const segments = Math.max(verts.length * 4, 8);
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, segments, 4, 6, closed),
        new THREE.MeshBasicMaterial({ color, transparent: f.depth !== undefined, opacity: f.depth !== undefined ? 0.75 : 1 })
      );
      group.add(tube);

      if (closed && verts.length >= 3) {
        // Translucent fill draped flat at the average elevation.
        const avgY = verts.reduce((s, v) => s + v.y, 0) / verts.length;
        const shape = new THREE.Shape(verts.map((v) => new THREE.Vector2(v.x, v.z)));
        const geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(Math.PI / 2); // shape XY → world XZ (y down → +z)
        const fill = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
        );
        fill.position.y = avgY + 1;
        group.add(fill);
      }
    }
  }
  return group;
}
