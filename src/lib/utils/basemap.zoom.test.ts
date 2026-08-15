import { describe, expect, it } from 'vitest';
import { BASEMAP_ZOOM_LEVELS, fixedBasemapTiles } from './basemap';
import { makeSite, wgs84ToSjtsk } from './geo';
import { siteClipPlanRect } from './siteClip';

// The basemap is a fixed camera-independent tile set covering the site clip
// rectangle (the property markers around Jivina 95).
const JIVINA = { lat: 49.797172, lon: 13.8331857 };
const s = wgs84ToSjtsk(JIVINA);
const site = makeSite(s.x, s.y, 492);

describe('fixed basemap coverage', () => {
  const tiles = fixedBasemapTiles(site);

  it('has every zoom level present (no level dropped by the tile cap)', () => {
    for (const z of BASEMAP_ZOOM_LEVELS) {
      expect(tiles.filter((t) => t.z === z).length, `level z${z} empty`).toBeGreaterThan(0);
    }
  });

  it('each level covers the whole clip rectangle', () => {
    const clip = siteClipPlanRect(site)!;
    expect(clip).not.toBeNull();
    const probes = [
      [clip.minX, clip.minY], [clip.maxX, clip.minY], [clip.minX, clip.maxY],
      [clip.maxX, clip.maxY], [(clip.minX + clip.maxX) / 2, (clip.minY + clip.maxY) / 2]
    ];
    for (const z of BASEMAP_ZOOM_LEVELS) {
      const level = tiles.filter((t) => t.z === z);
      for (const [px, py] of probes) {
        const covered = level.some((t) => {
          const se = { x: t.ne.x + t.sw.x - t.nw.x, y: t.ne.y + t.sw.y - t.nw.y };
          const xs = [t.nw.x, t.ne.x, t.sw.x, se.x];
          const ys = [t.nw.y, t.ne.y, t.sw.y, se.y];
          return px >= Math.min(...xs) && px <= Math.max(...xs) &&
                 py >= Math.min(...ys) && py <= Math.max(...ys);
        });
        expect(covered, `z${z}: (${px}, ${py}) uncovered`).toBe(true);
      }
    }
  });

  it('stays within a sane total tile budget', () => {
    expect(tiles.length).toBeLessThan(200);
  });

  it('returns nothing for a non-georeferenced site', () => {
    expect(fixedBasemapTiles(makeSite(0, 0, 0))).toEqual([]);
  });
});
