import { describe, expect, it } from 'vitest';
import { terrainFromElevations, terrainSampleGrid } from './defaultTerrain';
import { makeSite } from './geo';
import { siteClipSjtskRect } from './siteClip';

const site = makeSite(-777000, -1060000, 492);

describe('terrainSampleGrid', () => {
  it('covers the site clip rectangle exactly', () => {
    const g = terrainSampleGrid(site, 25);
    const r = siteClipSjtskRect();
    const xs = g.sjtsk.map((p) => p.x);
    const ys = g.sjtsk.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(r.minX);
    expect(Math.max(...xs)).toBeCloseTo(r.maxX);
    expect(Math.min(...ys)).toBeCloseTo(r.minY);
    expect(Math.max(...ys)).toBeCloseTo(r.maxY);
    expect(g.latlon.length).toBe(g.sjtsk.length);
    // ~740×780 m at 25 m — roughly a thousand samples, under the API cap.
    expect(g.sjtsk.length).toBeGreaterThan(500);
    expect(g.sjtsk.length).toBeLessThanOrEqual(2500);
  });
});

describe('terrainFromElevations', () => {
  it('assembles xyz triples, skipping missing samples', () => {
    const g = terrainSampleGrid(site, 100);
    const n = g.sjtsk.length;
    const elevations = g.sjtsk.map((_, i) => (i === 3 ? null : 490 + i * 0.1));
    const model = terrainFromElevations(g, elevations);
    expect(model).not.toBeNull();
    expect(model!.xyz.length).toBe((n - 1) * 3);
    expect(model!.xyz[2]).toBeCloseTo(490, 3);
  });

  it('returns null when almost nothing came back', () => {
    const g = terrainSampleGrid(site, 200);
    const model = terrainFromElevations(g, g.sjtsk.map(() => null));
    expect(model).toBeNull();
  });
});
