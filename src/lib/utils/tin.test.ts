import { describe, expect, it } from 'vitest';
import {
  buildTin, densify, heightAt, heightAtOrNearest, pointsInRadius, sculpt, terrainBounds
} from './tin';

/** Grid of points z = ax + by + c on [0..n)×[0..n) at `step` m spacing. */
function planeGrid(n: number, step: number, a: number, b: number, c: number): number[] {
  const xyz: number[] = [];
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      xyz.push(i * step, j * step, a * i * step + b * j * step + c);
  return xyz;
}

describe('buildTin / heightAt', () => {
  it('returns null for fewer than 3 points or collinear input', () => {
    expect(buildTin([0, 0, 1])).toBeNull();
    expect(buildTin([0, 0, 1, 1, 0, 2])).toBeNull();
    expect(buildTin([0, 0, 0, 1, 0, 0, 2, 0, 0])).toBeNull();
  });

  it('is exact at measured points', () => {
    const xyz = planeGrid(4, 1, 0.5, -0.25, 10);
    const tin = buildTin(xyz)!;
    for (let i = 0; i < tin.count; i++) {
      expect(heightAt(tin, xyz[i * 3], xyz[i * 3 + 1])).toBeCloseTo(xyz[i * 3 + 2], 9);
    }
  });

  it('reproduces a planar surface exactly between points', () => {
    const tin = buildTin(planeGrid(5, 2, 0.1, 0.3, 200))!;
    expect(heightAt(tin, 3.7, 5.1)).toBeCloseTo(0.1 * 3.7 + 0.3 * 5.1 + 200, 9);
  });

  it('returns null outside the hull and nearest-z via heightAtOrNearest', () => {
    const tin = buildTin(planeGrid(3, 1, 0, 0, 5))!;
    expect(heightAt(tin, -10, -10)).toBeNull();
    expect(heightAtOrNearest(tin, -10, -10)).toBe(5);
  });

  it('works with negative S-JTSK-scale coordinates', () => {
    const xyz = [
      -744400, -1042700, 320,
      -744395, -1042700, 321,
      -744400, -1042695, 322,
      -744395, -1042695, 323
    ];
    const tin = buildTin(xyz)!;
    const h = heightAt(tin, -744397.5, -1042697.5)!;
    expect(h).toBeGreaterThan(320);
    expect(h).toBeLessThan(323);
  });
});

describe('densify', () => {
  it('creates a clean 25 cm lattice inside the brush and preserves outside points bit-exactly', () => {
    const xyz = planeGrid(6, 2, 0.2, 0, 100); // sparse 2 m grid, 0..10 m
    const brush = { x: 5, y: 5, radius: 1.5 };
    const out = densify(xyz, brush);
    // Every original point outside the brush is preserved bit-exactly.
    const insideSet = new Set(pointsInRadius(xyz, brush.x, brush.y, brush.radius));
    const key = (x: number, y: number, z: number) => `${x}|${y}|${z}`;
    const outKeys = new Set<string>();
    for (let i = 0; i * 3 < out.length; i++) outKeys.add(key(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]));
    for (let i = 0; i * 3 < xyz.length; i++) {
      if (!insideSet.has(i)) expect(outKeys.has(key(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]))).toBe(true);
    }
    // Every point inside is on the 25 cm lattice (or a kept original ~on it).
    const inside = pointsInRadius(out, brush.x, brush.y, brush.radius);
    expect(inside.length).toBeGreaterThan(80); // π·1.5² / 0.25² ≈ 113 nodes
    for (const i of inside) {
      const dx = Math.abs(out[i * 3] / 0.25 - Math.round(out[i * 3] / 0.25));
      const dy = Math.abs(out[i * 3 + 1] / 0.25 - Math.round(out[i * 3 + 1] / 0.25));
      expect(Math.max(dx, dy)).toBeLessThan(0.5); // within spacing/2 of a node
    }
    // New points sample the planar surface.
    const tin = buildTin(out)!;
    expect(heightAt(tin, 5.1, 4.9)).toBeCloseTo(0.2 * 5.1 + 100, 2);
  });

  it('is a no-op on an already-densified area', () => {
    const xyz = planeGrid(9, 0.25, 0, 0, 50); // exact 25 cm lattice, 0..2 m
    const once = densify(xyz, { x: 1, y: 1, radius: 0.6 });
    expect(once).toBe(xyz); // returns the same array untouched
  });

  it('deletes swallowed sparse off-lattice originals inside the brush', () => {
    const xyz = [...planeGrid(6, 2, 0, 0, 10), 5.13, 5.07, 10]; // stray off-lattice point
    const out = densify(xyz, { x: 5, y: 5, radius: 1 });
    for (let i = 0; i * 3 < out.length; i++) {
      expect(out[i * 3] === 5.13 && out[i * 3 + 1] === 5.07).toBe(false);
    }
  });
});

describe('sculpt', () => {
  const flat = planeGrid(9, 0.25, 0, 0, 100);
  const brush = { x: 1, y: 1, radius: 0.7 };

  it('raise lifts the center most, leaves outside untouched, keeps mm precision', () => {
    const out = sculpt(flat, brush, { type: 'raise', amount: 0.5 });
    const tin = buildTin(out)!;
    expect(heightAt(tin, 1, 1)).toBeCloseTo(100.5, 3);
    expect(heightAt(tin, 0, 0)).toBeCloseTo(100, 9);
    for (let i = 0; i * 3 < out.length; i++) {
      const d = Math.hypot(out[i * 3] - 1, out[i * 3 + 1] - 1);
      if (d > brush.radius) expect(out[i * 3 + 2]).toBe(flat[i * 3 + 2]);
      expect(out[i * 3 + 2]).toBe(Math.round(out[i * 3 + 2] * 1000) / 1000);
    }
  });

  it('setHeight flattens the brush to an absolute Bpv height', () => {
    const out = sculpt(flat, brush, { type: 'setHeight', z: 102.34 });
    for (const i of pointsInRadius(out, 1, 1, 0.7)) expect(out[i * 3 + 2]).toBe(102.34);
  });

  it('level averages the brush area', () => {
    const sloped = planeGrid(9, 0.25, 1, 0, 0);
    const out = sculpt(sloped, brush, { type: 'level' });
    const inside = pointsInRadius(out, 1, 1, 0.7);
    const first = out[inside[0] * 3 + 2];
    for (const i of inside) expect(out[i * 3 + 2]).toBe(first);
  });

  it('smooth pulls a spike toward its neighborhood', () => {
    const spiky = flat.slice();
    // Point at (1,1) is index? find it and spike it.
    const idx = pointsInRadius(spiky, 1, 1, 0.01)[0];
    spiky[idx * 3 + 2] = 105;
    const out = sculpt(spiky, brush, { type: 'smooth', amount: 1 });
    expect(out[idx * 3 + 2]).toBeLessThan(103);
    expect(out[idx * 3 + 2]).toBeGreaterThan(100);
  });
});

describe('terrainBounds', () => {
  it('computes bbox and returns null for empty input', () => {
    expect(terrainBounds([])).toBeNull();
    expect(terrainBounds([1, 2, 3, -4, 5, 6])).toEqual({
      minX: -4, maxX: 1, minY: 2, maxY: 5, minZ: 3, maxZ: 6
    });
  });
});
