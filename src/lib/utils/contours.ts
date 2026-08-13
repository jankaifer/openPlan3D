import type { Tin } from './tin';

/**
 * Elevation contour extraction from a terrain TIN. Pure geometry: returns
 * line segments in S-JTSK meters, grouped per contour level; adapters turn
 * them into canvas strokes or 3D lines.
 */

export interface ContourLevel {
  /** Bpv elevation of this contour, meters. */
  level: number;
  /** Flat [x1, y1, x2, y2, ...] segment list, S-JTSK meters. */
  segments: number[];
}

/**
 * Cut the TIN with horizontal planes every `interval` meters (levels are
 * absolute multiples of the interval, so contours match round elevations).
 */
export function contoursFromTin(tin: Tin, interval = 0.5): ContourLevel[] {
  const { triangles, xyz } = tin;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < tin.count; i++) {
    const z = xyz[i * 3 + 2];
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!isFinite(minZ) || maxZ - minZ < 1e-9) return [];

  const out: ContourLevel[] = [];
  const first = Math.ceil(minZ / interval);
  const last = Math.floor(maxZ / interval);
  for (let li = first; li <= last; li++) {
    const level = li * interval;
    const segments: number[] = [];
    for (let t = 0; t < triangles.length; t += 3) {
      const ia = triangles[t], ib = triangles[t + 1], ic = triangles[t + 2];
      const za = xyz[ia * 3 + 2], zb = xyz[ib * 3 + 2], zc = xyz[ic * 3 + 2];
      const lo = Math.min(za, zb, zc), hi = Math.max(za, zb, zc);
      if (level < lo || level > hi || lo === hi) continue;
      // Interpolate the crossing point on each edge the level passes through.
      const pts: number[] = [];
      const edge = (i0: number, z0: number, i1: number, z1: number) => {
        if ((z0 - level) * (z1 - level) > 0 || z0 === z1) return;
        const f = (level - z0) / (z1 - z0);
        if (f < 0 || f > 1) return;
        pts.push(
          xyz[i0 * 3] + f * (xyz[i1 * 3] - xyz[i0 * 3]),
          xyz[i0 * 3 + 1] + f * (xyz[i1 * 3 + 1] - xyz[i0 * 3 + 1])
        );
      };
      edge(ia, za, ib, zb);
      edge(ib, zb, ic, zc);
      edge(ic, zc, ia, za);
      if (pts.length >= 4) segments.push(pts[0], pts[1], pts[2], pts[3]);
    }
    if (segments.length > 0) out.push({ level, segments });
  }
  return out;
}
