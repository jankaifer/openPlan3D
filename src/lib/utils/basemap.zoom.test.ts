import { describe, expect, it } from 'vitest';
import { BASEMAP_PYRAMID, fixedBasemapTiles } from './basemap';
import { makeSite, wgs84ToSjtsk } from './geo';

// The basemap is a fixed camera-independent pyramid around the site origin.
const JIVINA = { lat: 49.797172, lon: 13.8331857 };
const s = wgs84ToSjtsk(JIVINA);
const site = makeSite(s.x, s.y, 492);

describe('fixed basemap pyramid', () => {
  const tiles = fixedBasemapTiles(site);

  it('has every pyramid level present (no level dropped by the tile cap)', () => {
    for (const { z } of BASEMAP_PYRAMID) {
      expect(tiles.filter((t) => t.z === z).length, `level z${z} empty`).toBeGreaterThan(0);
    }
  });

  it('each level covers its intended extent around the origin', () => {
    for (const { z, halfExtentM } of BASEMAP_PYRAMID) {
      const level = tiles.filter((t) => t.z === z);
      // Sample plan points across the extent; each must fall in some tile bbox.
      const h = halfExtentM * 100;
      for (const [px, py] of [[0, 0], [-h, -h], [h, h], [-h, h], [h, -h], [h / 2, -h / 3]]) {
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
    expect(tiles.length).toBeLessThan(260);
  });

  it('returns nothing for a non-georeferenced site', () => {
    expect(fixedBasemapTiles(makeSite(0, 0, 0))).toEqual([]);
  });
});
