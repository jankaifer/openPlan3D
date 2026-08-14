import { describe, expect, it } from 'vitest';
import { terrainFromElevations, terrainSampleGrid } from './defaultTerrain';
import { makeSite } from './geo';

const site = makeSite(-777000, -1060000, 492);

describe('terrainSampleGrid', () => {
  it('builds a centered square grid', () => {
    const g = terrainSampleGrid(site, 100, 25);
    expect(g.sjtsk.length).toBe(25); // 5×5
    expect(g.latlon.length).toBe(25);
    const xs = g.sjtsk.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(site.renderOrigin.x - 50);
    expect(Math.max(...xs)).toBeCloseTo(site.renderOrigin.x + 50);
    // center point is the origin itself
    expect(g.sjtsk[12]).toEqual({ x: site.renderOrigin.x, y: site.renderOrigin.y });
  });
});

describe('terrainFromElevations', () => {
  it('assembles xyz triples, skipping missing samples', () => {
    const g = terrainSampleGrid(site, 100, 25);
    const elevations = g.sjtsk.map((_, i) => (i === 3 ? null : 490 + i * 0.1));
    const model = terrainFromElevations(g, elevations);
    expect(model).not.toBeNull();
    expect(model!.xyz.length).toBe((25 - 1) * 3);
    expect(model!.xyz[2]).toBeCloseTo(490, 3);
  });

  it('returns null when almost nothing came back', () => {
    const g = terrainSampleGrid(site, 100, 50);
    const model = terrainFromElevations(g, g.sjtsk.map(() => null));
    expect(model).toBeNull();
  });
});
