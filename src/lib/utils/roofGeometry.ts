import type { Point, Roof } from '$lib/models/types';

/**
 * Roof solid generation. Pure geometry in plan-space cm: returns triangles in
 * "roof space" — x/y = plan, z = height above the roof's base elevation. The
 * 3D adapter maps these into world coordinates.
 *
 * Gable/hip/shed roofs are parametrized over the outline's oriented bounding
 * box (rectangle-ish footprints — good enough for low-fidelity massing);
 * flat roofs use the exact outline.
 */

export interface RoofMeshData {
  /** Vertex triples [x, y, z], z up from base elevation, cm. */
  vertices: number[];
  /** Triangle indices (counterclockwise seen from above/outside). */
  indices: number[];
}

interface Obb {
  center: Point;
  /** Unit axis of the long side. */
  axis: Point;
  halfLength: number;
  halfWidth: number;
}

/** Oriented bounding box via best edge direction of the outline. */
export function outlineObb(outline: Point[], ridgeAzimuthDeg?: number): Obb | null {
  if (outline.length < 3) return null;
  let bestArea = Infinity;
  let best: Obb | null = null;
  const dirs: number[] = [];
  if (ridgeAzimuthDeg !== undefined) {
    dirs.push((ridgeAzimuthDeg * Math.PI) / 180);
  } else {
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      dirs.push(Math.atan2(b.y - a.y, b.x - a.x));
    }
  }
  for (const ang of dirs) {
    const ux = Math.cos(ang), uy = Math.sin(ang);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of outline) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const lenU = maxU - minU, lenV = maxV - minV;
    const area = lenU * lenV;
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      const long = lenU >= lenV;
      best = {
        center: { x: cu * ux - cv * uy, y: cu * uy + cv * ux },
        axis: long ? { x: ux, y: uy } : { x: -uy, y: ux },
        halfLength: Math.max(lenU, lenV) / 2,
        halfWidth: Math.min(lenU, lenV) / 2
      };
    }
  }
  return best;
}

/** Fan-triangulate a convex-ish outline (flat roofs). */
function fanIndices(n: number, flip = false): number[] {
  const out: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (flip) out.push(0, i + 1, i);
    else out.push(0, i, i + 1);
  }
  return out;
}

export function buildRoofMesh(roof: Roof): RoofMeshData | null {
  const { outline, kind, pitchDeg, overhang, thickness } = roof;
  if (outline.length < 3) return null;
  const t = Math.max(thickness, 1);

  if (kind === 'flat') {
    // Exact outline extruded upward by thickness.
    const n = outline.length;
    const vertices: number[] = [];
    for (const p of outline) vertices.push(p.x, p.y, 0);
    for (const p of outline) vertices.push(p.x, p.y, t);
    const indices = [...fanIndices(n, true)]; // bottom (facing down)
    for (const [a, b, c] of chunk3(fanIndices(n))) indices.push(a + n, b + n, c + n); // top
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      indices.push(i, j, i + n, j, j + n, i + n);
    }
    return { vertices, indices };
  }

  const obb = outlineObb(outline, roof.ridgeAzimuthDeg);
  if (!obb) return null;
  const { center, axis } = obb;
  const hl = obb.halfLength + overhang;
  const hw = obb.halfWidth + overhang;
  const nx = -axis.y, ny = axis.x; // across-ridge unit
  const slope = Math.tan((pitchDeg * Math.PI) / 180);

  const P = (u: number, v: number, z: number): [number, number, number] => [
    center.x + axis.x * u + nx * v,
    center.y + axis.y * u + ny * v,
    z
  ];

  const vertices: number[] = [];
  const indices: number[] = [];
  const push = (p: [number, number, number]) => (vertices.push(...p), vertices.length / 3 - 1);
  const quad = (a: number, b: number, c: number, d: number) => indices.push(a, b, c, a, c, d);

  if (kind === 'shed') {
    // Single plane rising across the width from -hw (low) to +hw (high).
    const rise = 2 * hw * slope;
    const lo0 = push(P(-hl, -hw, 0)), lo1 = push(P(hl, -hw, 0));
    const hi1 = push(P(hl, hw, rise)), hi0 = push(P(-hl, hw, rise));
    const lo0t = push(P(-hl, -hw, t)), lo1t = push(P(hl, -hw, t));
    const hi1t = push(P(hl, hw, rise + t)), hi0t = push(P(-hl, hw, rise + t));
    quad(lo0, lo1, hi1, hi0);          // underside
    quad(lo0t, hi0t, hi1t, lo1t);      // top
    quad(lo0, hi0, hi0t, lo0t);        // end caps + edges
    quad(lo1, lo1t, hi1t, hi1);
    quad(lo0, lo0t, lo1t, lo1);
    quad(hi0, hi1, hi1t, hi0t);
    return { vertices, indices };
  }

  // Gable (and hip approximated as gable-with-pulled-in-ridge).
  const ridgeH = hw * slope;
  const pullIn = kind === 'hip' ? Math.min(hw, hl * 0.999) : 0;
  const e0 = [push(P(-hl, -hw, 0)), push(P(hl, -hw, 0)), push(P(hl, hw, 0)), push(P(-hl, hw, 0))];
  const e1 = [push(P(-hl, -hw, t)), push(P(hl, -hw, t)), push(P(hl, hw, t)), push(P(-hl, hw, t))];
  const r0 = push(P(-hl + pullIn, 0, ridgeH));
  const r1 = push(P(hl - pullIn, 0, ridgeH));
  const r0t = push(P(-hl + pullIn, 0, ridgeH + t));
  const r1t = push(P(hl - pullIn, 0, ridgeH + t));

  quad(e0[0], e0[1], e0[2], e0[3]); // underside (eave rectangle, facing down)
  // Roof planes (top).
  quad(e1[0], e1[1], r1t, r0t);     // south slope
  quad(e1[2], e1[3], r0t, r1t);     // north slope
  // Eave edges.
  quad(e0[0], e1[0], e1[1], e0[1]);
  quad(e0[2], e1[2], e1[3], e0[3]);
  if (kind === 'hip') {
    // Hip end triangles.
    indices.push(e1[1], e1[2], r1t, e1[3], e1[0], r0t);
    indices.push(e0[1], r1, e0[2], e0[3], r0, e0[0]);
    indices.push(e0[1], e1[1], r1t); indices.push(e0[1], r1t, r1);
    indices.push(e0[2], r1, r1t); indices.push(e0[2], r1t, e1[2]);
    indices.push(e0[0], r0, r0t); indices.push(e0[0], r0t, e1[0]);
    indices.push(e0[3], e1[3], r0t); indices.push(e0[3], r0t, r0);
  } else {
    // Gable end walls (vertical triangles at ±hl).
    indices.push(e1[0], e1[3], r0t, e0[0], r0, e0[3]);
    indices.push(e1[2], e1[1], r1t, e0[2], r1, e0[1]);
    indices.push(e0[0], e1[0], r0t); indices.push(e0[0], r0t, r0);
    indices.push(e0[3], r0, r0t); indices.push(e0[3], r0t, e1[3]);
    indices.push(e0[1], r1, r1t); indices.push(e0[1], r1t, e1[1]);
    indices.push(e0[2], e1[2], r1t); indices.push(e0[2], r1t, r1);
  }
  return { vertices, indices };
}

function chunk3(arr: number[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < arr.length; i += 3) out.push([arr[i], arr[i + 1], arr[i + 2]]);
  return out;
}

/** Highest point of the roof above its base elevation, cm. */
export function roofPeakHeight(roof: Roof): number {
  if (roof.kind === 'flat') return roof.thickness;
  const obb = outlineObb(roof.outline, roof.ridgeAzimuthDeg);
  if (!obb) return roof.thickness;
  const hw = obb.halfWidth + roof.overhang;
  if (roof.kind === 'shed') return 2 * hw * Math.tan((roof.pitchDeg * Math.PI) / 180) + roof.thickness;
  return hw * Math.tan((roof.pitchDeg * Math.PI) / 180) + roof.thickness;
}
