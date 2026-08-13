import { describe, expect, it } from 'vitest';
import type { Roof } from '$lib/models/types';
import { buildRoofMesh, outlineObb, roofPeakHeight } from './roofGeometry';

const rect: Roof['outline'] = [
  { x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 400 }, { x: 0, y: 400 }
];

function roof(partial: Partial<Roof>): Roof {
  return {
    id: 'r1', outline: rect, kind: 'gable', pitchDeg: 45, overhang: 0,
    baseElevation: 280, thickness: 20, color: '#884422', ...partial
  };
}

describe('outlineObb', () => {
  it('finds the long axis of an axis-aligned rectangle', () => {
    const obb = outlineObb(rect)!;
    expect(obb.halfLength).toBeCloseTo(400, 6);
    expect(obb.halfWidth).toBeCloseTo(200, 6);
    expect(Math.abs(obb.axis.x)).toBeCloseTo(1, 6);
    expect(obb.center.x).toBeCloseTo(400, 6);
    expect(obb.center.y).toBeCloseTo(200, 6);
  });

  it('follows a rotated outline', () => {
    const rot = rect.map((p) => ({
      x: p.x * Math.SQRT1_2 - p.y * Math.SQRT1_2,
      y: p.x * Math.SQRT1_2 + p.y * Math.SQRT1_2
    }));
    const obb = outlineObb(rot)!;
    expect(obb.halfLength).toBeCloseTo(400, 4);
    expect(obb.halfWidth).toBeCloseTo(200, 4);
  });
});

describe('buildRoofMesh', () => {
  it('gable at 45° peaks at halfWidth above the eaves', () => {
    const r = roof({ kind: 'gable' });
    const mesh = buildRoofMesh(r)!;
    let maxZ = -Infinity;
    for (let i = 2; i < mesh.vertices.length; i += 3) maxZ = Math.max(maxZ, mesh.vertices[i]);
    expect(maxZ).toBeCloseTo(200 + 20, 6); // ridge 200 + thickness 20
    expect(roofPeakHeight(r)).toBeCloseTo(220, 6);
    expect(mesh.indices.length % 3).toBe(0);
  });

  it('shed rises across the full width', () => {
    const r = roof({ kind: 'shed', pitchDeg: 30 });
    expect(roofPeakHeight(r)).toBeCloseTo(400 * Math.tan(Math.PI / 6) + 20, 6);
  });

  it('flat extrudes the exact outline by thickness', () => {
    const mesh = buildRoofMesh(roof({ kind: 'flat' }))!;
    expect(mesh.vertices.length).toBe(rect.length * 2 * 3);
    const zs = new Set<number>();
    for (let i = 2; i < mesh.vertices.length; i += 3) zs.add(mesh.vertices[i]);
    expect([...zs].sort((a, b) => a - b)).toEqual([0, 20]);
  });

  it('overhang widens the roof footprint', () => {
    const mesh = buildRoofMesh(roof({ kind: 'gable', overhang: 50 }))!;
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      minX = Math.min(minX, mesh.vertices[i]);
      maxX = Math.max(maxX, mesh.vertices[i]);
    }
    expect(minX).toBeCloseTo(-50, 6);
    expect(maxX).toBeCloseTo(850, 6);
  });

  it('returns null for degenerate outlines', () => {
    expect(buildRoofMesh(roof({ outline: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }))).toBeNull();
  });
});
