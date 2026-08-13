import type { GisFeature, GisFeatureKind, GisLayer, SiteConfig } from '$lib/models/types';
import type { Tin } from './tin';
import { heightAtOrNearest } from './tin';
import { planFromSjtsk } from './geo';

/** Domain helpers for GIS layers/features. Pure data in/out. */

let counter = 0;
function newId(prefix: string): string {
  // Math.random-free id: time is injected by callers via project.updatedAt if
  // determinism matters; uniqueness within a session is enough here.
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export const DEFAULT_LAYER_COLORS = ['#e11d48', '#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0891b2'];

export function makeLayer(name: string, existing: GisLayer[]): GisLayer {
  return {
    id: newId('lyr'),
    name,
    color: DEFAULT_LAYER_COLORS[existing.length % DEFAULT_LAYER_COLORS.length],
    lineStyle: 'solid',
    visible: true
  };
}

export function makeFeature(layerId: string, kind: GisFeatureKind): GisFeature {
  return { id: newId('gf'), layerId, kind, vertices: [] };
}

/**
 * Effective elevation (S-JTSK/Bpv meters) of a feature vertex:
 * explicit z wins; `depth` (cm) puts it below the terrain surface; otherwise
 * it sits on the surface (or 0 without terrain).
 */
export function vertexElevation(
  feature: GisFeature,
  vertexIndex: number,
  tin: Tin | null
): number {
  const v = feature.vertices[vertexIndex];
  if (v.z !== undefined && feature.depth === undefined) return v.z;
  const surface = tin ? heightAtOrNearest(tin, v.x, v.y) : 0;
  if (feature.depth !== undefined) return surface - feature.depth / 100;
  return surface;
}

/** Feature vertices as plan-space cm points (with elevation resolved). */
export function featurePlanVertices(
  feature: GisFeature,
  site: SiteConfig,
  tin: Tin | null
): { x: number; y: number; z: number }[] {
  return feature.vertices.map((v, i) => {
    const p = planFromSjtsk(site, v.x, v.y, vertexElevation(feature, i, tin));
    return { x: p.x, y: p.y, z: p.z! };
  });
}

/** Polyline length in meters (2D, S-JTSK plane). */
export function featureLength(feature: GisFeature): number {
  let len = 0;
  for (let i = 1; i < feature.vertices.length; i++) {
    const a = feature.vertices[i - 1], b = feature.vertices[i];
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (feature.kind === 'polygon' && feature.vertices.length > 2) {
    const a = feature.vertices[feature.vertices.length - 1], b = feature.vertices[0];
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

/** Polygon area in m² (shoelace; 0 for non-polygons). */
export function featureArea(feature: GisFeature): number {
  if (feature.kind !== 'polygon' || feature.vertices.length < 3) return 0;
  let sum = 0;
  const vs = feature.vertices;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i], b = vs[(i + 1) % vs.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}
