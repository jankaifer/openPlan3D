import { describe, expect, it } from 'vitest';
import { buildTin } from './tin';
import { contoursFromTin } from './contours';

describe('contoursFromTin', () => {
  it('returns nothing for a flat surface', () => {
    const tin = buildTin([0, 0, 5, 10, 0, 5, 0, 10, 5, 10, 10, 5])!;
    expect(contoursFromTin(tin, 0.5)).toEqual([]);
  });

  it('cuts a uniform slope into straight, evenly spaced contours', () => {
    // z rises 0→4 m along x over 40 m: slope 0.1, contour every 1 m → x = 10·level
    const xyz: number[] = [];
    for (let i = 0; i <= 4; i++)
      for (let j = 0; j <= 4; j++) xyz.push(i * 10, j * 10, i);
    const tin = buildTin(xyz)!;
    const levels = contoursFromTin(tin, 1);
    expect(levels.map((l) => l.level)).toEqual([0, 1, 2, 3, 4]);
    for (const { level, segments } of levels) {
      if (level === 0 || level === 4) continue; // boundary contours may be partial
      expect(segments.length).toBeGreaterThan(0);
      for (let s = 0; s < segments.length; s += 2) {
        expect(segments[s]).toBeCloseTo(level * 10, 6); // every x on the iso-line
      }
    }
  });

  it('uses absolute multiples of the interval as levels', () => {
    const xyz = [0, 0, 317.3, 10, 0, 318.9, 0, 10, 317.3, 10, 10, 318.9];
    const tin = buildTin(xyz)!;
    const levels = contoursFromTin(tin, 0.5).map((l) => l.level);
    expect(levels).toEqual([317.5, 318, 318.5]);
  });
});
