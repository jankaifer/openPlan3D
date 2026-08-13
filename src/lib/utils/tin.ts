import Delaunator from 'delaunator';
import { roundMm } from './geo';

/**
 * Terrain as a TIN (triangulated irregular network) over exact survey/design
 * points. All coordinates are S-JTSK meters (x east, y north, z Bpv); points
 * are stored as consecutive [x, y, z] triples in a flat array (see
 * TerrainModel in models/types.ts). Everything here is pure: functions take
 * plain data and return new arrays, so behavior is unit-testable headlessly.
 */

export interface Tin {
  /** The source point triples (not copied). */
  xyz: number[];
  /** Point count. */
  count: number;
  /** Delaunay triangle vertex indices (point indices), triples per triangle. */
  triangles: Uint32Array;
  /** Halfedge adjacency (delaunator format). */
  halfedges: Int32Array;
  /** Hull point indices, counterclockwise. */
  hull: Uint32Array;
}

/** Spacing (m) of the lattice sculpt tools densify to before editing. */
export const DENSIFY_SPACING = 0.25;

export interface Brush {
  /** Center, S-JTSK meters. */
  x: number;
  y: number;
  /** Radius, meters. */
  radius: number;
}

export type SculptOp =
  | { type: 'raise'; amount: number }        // meters at brush center, cosine falloff
  | { type: 'lower'; amount: number }
  | { type: 'level' }                        // flatten to mean height in brush
  | { type: 'setHeight'; z: number }         // absolute Bpv meters
  | { type: 'smooth'; amount: number };      // 0..1 blend toward neighborhood mean

/** Build the Delaunay TIN. Returns null with fewer than 3 points (no surface). */
export function buildTin(xyz: number[]): Tin | null {
  const count = Math.floor(xyz.length / 3);
  if (count < 3) return null;
  const coords = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) {
    coords[i * 2] = xyz[i * 3];
    coords[i * 2 + 1] = xyz[i * 3 + 1];
  }
  const d = new Delaunator(coords);
  if (d.triangles.length === 0) return null; // fully collinear input
  return { xyz, count, triangles: d.triangles, halfedges: d.halfedges, hull: d.hull };
}

function orient(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

/**
 * Locate the triangle containing (x, y) by walking across halfedges from
 * `startTri`. Returns the triangle index, or -1 when the point is outside the
 * hull.
 */
export function locateTriangle(tin: Tin, x: number, y: number, startTri = 0): number {
  const { triangles, halfedges, xyz } = tin;
  const triCount = triangles.length / 3;
  if (triCount === 0) return -1;
  let t = Math.min(Math.max(startTri, 0), triCount - 1);
  const maxSteps = triCount * 3 + 10;
  let e0 = t * 3;
  for (let step = 0; step < maxSteps; step++) {
    let crossed = false;
    for (let i = 0; i < 3; i++) {
      const e = t * 3 + ((e0 + i) % 3);
      const a = triangles[e];
      const b = triangles[t * 3 + ((e0 + i + 1) % 3)];
      // Delaunator triangles wind clockwise (y-up), so the interior is on the
      // negative side of each directed edge; a positive orient means the
      // query point is across this edge.
      if (
        orient(xyz[a * 3], xyz[a * 3 + 1], xyz[b * 3], xyz[b * 3 + 1], x, y) > 1e-12
      ) {
        const opposite = halfedges[e];
        if (opposite === -1) return -1; // walked off the hull
        t = Math.floor(opposite / 3);
        e0 = opposite % 3;
        crossed = true;
        break;
      }
    }
    if (!crossed) return t;
  }
  return -1; // safety cap; degenerate input
}

/**
 * Surface height at (x, y) via barycentric interpolation, or null outside the
 * hull.
 */
export function heightAt(tin: Tin, x: number, y: number, startTri = 0): number | null {
  const t = locateTriangle(tin, x, y, startTri);
  if (t < 0) return null;
  const { triangles, xyz } = tin;
  const a = triangles[t * 3], b = triangles[t * 3 + 1], c = triangles[t * 3 + 2];
  const ax = xyz[a * 3], ay = xyz[a * 3 + 1];
  const bx = xyz[b * 3], by = xyz[b * 3 + 1];
  const cx = xyz[c * 3], cy = xyz[c * 3 + 1];
  const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(det) < 1e-12) return xyz[a * 3 + 2];
  const wa = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
  const wb = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
  const wc = 1 - wa - wb;
  return wa * xyz[a * 3 + 2] + wb * xyz[b * 3 + 2] + wc * xyz[c * 3 + 2];
}

/** Like heightAt, but falls back to the nearest point's z outside the hull. */
export function heightAtOrNearest(tin: Tin, x: number, y: number): number {
  const h = heightAt(tin, x, y);
  if (h !== null) return h;
  const { xyz, count } = tin;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < count; i++) {
    const d = (xyz[i * 3] - x) ** 2 + (xyz[i * 3 + 1] - y) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return xyz[best * 3 + 2];
}

/** Indices of points within `radius` meters of (x, y). */
export function pointsInRadius(xyz: ArrayLike<number>, x: number, y: number, radius: number): number[] {
  const out: number[] = [];
  const r2 = radius * radius;
  for (let i = 0; i * 3 < xyz.length; i++) {
    if ((xyz[i * 3] - x) ** 2 + (xyz[i * 3 + 1] - y) ** 2 <= r2) out.push(i);
  }
  return out;
}

/**
 * Densify the brush area to a clean lattice of `spacing` meters (nodes on
 * absolute multiples of the spacing, so adjacent edits line up):
 *
 * - a lattice node with an existing point within spacing/2 keeps that point;
 * - other lattice nodes get a new point with z sampled from the current
 *   surface;
 * - remaining (sparse, off-lattice) pre-existing points inside the brush are
 *   deleted so the lattice stays clean.
 *
 * Points outside the brush are preserved bit-exactly. Returns a new array (or
 * the input array unchanged when the area is already fully densified).
 */
export function densify(xyz: number[], brush: Brush, spacing = DENSIFY_SPACING): number[] {
  const tin = buildTin(xyz);
  const inside = new Set(pointsInRadius(xyz, brush.x, brush.y, brush.radius));

  // Candidate lattice nodes within the brush.
  const nodes: { x: number; y: number }[] = [];
  const iMin = Math.ceil((brush.x - brush.radius) / spacing);
  const iMax = Math.floor((brush.x + brush.radius) / spacing);
  const jMin = Math.ceil((brush.y - brush.radius) / spacing);
  const jMax = Math.floor((brush.y + brush.radius) / spacing);
  const r2 = brush.radius * brush.radius;
  for (let i = iMin; i <= iMax; i++) {
    for (let j = jMin; j <= jMax; j++) {
      const nx = i * spacing, ny = j * spacing;
      if ((nx - brush.x) ** 2 + (ny - brush.y) ** 2 <= r2) nodes.push({ x: nx, y: ny });
    }
  }
  if (nodes.length === 0) return xyz;

  // Match lattice nodes to existing inside points (nearest within spacing/2).
  const half = spacing / 2;
  const kept = new Set<number>();
  const toAdd: { x: number; y: number }[] = [];
  for (const n of nodes) {
    let best = -1, bestD = half * half;
    for (const p of inside) {
      if (kept.has(p)) continue;
      const d = (xyz[p * 3] - n.x) ** 2 + (xyz[p * 3 + 1] - n.y) ** 2;
      if (d <= bestD) { bestD = d; best = p; }
    }
    if (best >= 0) kept.add(best);
    else toAdd.push(n);
  }
  const toDelete = [...inside].filter((p) => !kept.has(p));
  if (toAdd.length === 0 && toDelete.length === 0) return xyz;

  const out: number[] = [];
  for (let i = 0; i * 3 < xyz.length; i++) {
    if (inside.has(i) && !kept.has(i)) continue;
    out.push(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]);
  }
  for (const n of toAdd) {
    const z = tin ? heightAtOrNearest(tin, n.x, n.y) : 0;
    out.push(roundMm(n.x), roundMm(n.y), roundMm(z));
  }
  return out;
}

/**
 * Apply a sculpt operation to all points within the brush. Callers normally
 * `densify()` first so the edit has a clean 25 cm lattice to move. Points
 * outside the brush are untouched. Returns a new array.
 */
export function sculpt(
  xyz: number[],
  brush: Brush,
  op: SculptOp,
  /**
   * Optional stroke memory: points whose "x|y" key is present are skipped, and
   * every edited point's key is added — so dragging a stroke applies each op
   * once per point even as the brush passes repeatedly. Keys are coordinates
   * (not indices) because densify() renumbers points.
   */
  touched?: Set<string>
): number[] {
  let idx = pointsInRadius(xyz, brush.x, brush.y, brush.radius);
  if (touched) {
    idx = idx.filter((i) => !touched.has(`${xyz[i * 3]}|${xyz[i * 3 + 1]}`));
    for (const i of idx) touched.add(`${xyz[i * 3]}|${xyz[i * 3 + 1]}`);
  }
  if (idx.length === 0) return xyz;
  const out = xyz.slice();

  const falloff = (i: number) => {
    const d = Math.hypot(xyz[i * 3] - brush.x, xyz[i * 3 + 1] - brush.y);
    return Math.cos((Math.min(d / brush.radius, 1) * Math.PI) / 2) ** 2;
  };

  if (op.type === 'raise' || op.type === 'lower') {
    const sign = op.type === 'raise' ? 1 : -1;
    for (const i of idx) out[i * 3 + 2] = roundMm(xyz[i * 3 + 2] + sign * op.amount * falloff(i));
  } else if (op.type === 'setHeight') {
    for (const i of idx) out[i * 3 + 2] = roundMm(op.z);
  } else if (op.type === 'level') {
    let sum = 0;
    for (const i of idx) sum += xyz[i * 3 + 2];
    const mean = sum / idx.length;
    for (const i of idx) out[i * 3 + 2] = roundMm(mean);
  } else if (op.type === 'smooth') {
    const r = brush.radius;
    for (const i of idx) {
      const neighbors = pointsInRadius(xyz, xyz[i * 3], xyz[i * 3 + 1], r / 2);
      let sum = 0;
      for (const n of neighbors) sum += xyz[n * 3 + 2];
      const mean = sum / neighbors.length;
      const a = Math.min(Math.max(op.amount, 0), 1) * falloff(i);
      out[i * 3 + 2] = roundMm(xyz[i * 3 + 2] * (1 - a) + mean * a);
    }
  }
  return out;
}

/** Bounding box of a terrain point array, or null when empty. */
export function terrainBounds(xyz: number[]): { minX: number; minY: number; maxX: number; maxY: number; minZ: number; maxZ: number } | null {
  if (xyz.length < 3) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i * 3 < xyz.length; i++) {
    const x = xyz[i * 3], y = xyz[i * 3 + 1], z = xyz[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minY, maxX, maxY, minZ, maxZ };
}
