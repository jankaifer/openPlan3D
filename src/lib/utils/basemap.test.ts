import { describe, expect, it } from 'vitest';
import {
  MAX_TILES_PER_VIEW, groundResolution, lonLatToTileFrac, pickTileZoom,
  tileToLonLat, tileUrl, tilesForPlanRect
} from './basemap';
import { makeSite, wgs84ToSjtsk } from './geo';

// Jivina 90 (okres Beroun)
const JIVINA = { lat: 49.797172, lon: 13.8331857 };

describe('tile math', () => {
  it('maps lon/lat to tiles and back (roundtrip)', () => {
    const f = lonLatToTileFrac(JIVINA.lon, JIVINA.lat, 17);
    const back = tileToLonLat(f.x, f.y, 17);
    expect(back.lon).toBeCloseTo(JIVINA.lon, 9);
    expect(back.lat).toBeCloseTo(JIVINA.lat, 9);
  });

  it('places the null island at the world tile center', () => {
    const f = lonLatToTileFrac(0, 0, 0);
    expect(f.x).toBeCloseTo(0.5);
    expect(f.y).toBeCloseTo(0.5);
  });

  it('ground resolution halves per zoom level', () => {
    expect(groundResolution(50, 15) / groundResolution(50, 16)).toBeCloseTo(2);
  });

  it('picks a finer tile zoom as the canvas zooms in', () => {
    const zOut = pickTileZoom(50, 0.002);
    const zIn = pickTileZoom(50, 0.05);
    expect(zIn).toBeGreaterThan(zOut);
    expect(zIn).toBeLessThanOrEqual(19); // clamped at max provider zoom
  });

  it('builds tile URLs for both providers', () => {
    expect(tileUrl('osm', 17, 70556, 44540)).toContain('openstreetmap.org/17/70556/44540');
    expect(tileUrl('satellite', 17, 70556, 44540)).toContain('World_Imagery/MapServer/tile/17/44540/70556');
  });
});

describe('tilesForPlanRect', () => {
  const s = wgs84ToSjtsk(JIVINA);
  const site = makeSite(s.x, s.y, 492);

  it('returns [] for a non-georeferenced site', () => {
    expect(tilesForPlanRect(makeSite(0, 0, 0), -1000, -1000, 1000, 1000, 17)).toEqual([]);
  });

  it('covers a 100 m view with correctly placed tiles', () => {
    const tiles = tilesForPlanRect(site, -5000, -5000, 5000, 5000, 17);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(MAX_TILES_PER_VIEW);
    // The tile containing the origin must be present, and its corners must
    // straddle the origin (nw is up-left in plan space: x smaller, y smaller).
    const containing = tiles.find(
      (t) => t.nw.x <= 0 && t.ne.x >= 0 && t.nw.y <= 0 && t.sw.y >= 0
    );
    expect(containing).toBeTruthy();
    // Tile edge length at z17/lat49.8 ≈ 197 m; plan units are cm.
    const edge = Math.hypot(containing!.ne.x - containing!.nw.x, containing!.ne.y - containing!.nw.y);
    expect(edge).toBeGreaterThan(18000);
    expect(edge).toBeLessThan(21000);
  });

  it('caps runaway tile counts', () => {
    expect(tilesForPlanRect(site, -5e6, -5e6, 5e6, 5e6, 19)).toEqual([]);
  });
});
