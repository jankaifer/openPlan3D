import type { SiteConfig, TerrainModel } from '$lib/models/types';
import { roundMm, sjtskToWgs84 } from './geo';
import { siteClipSjtskRect } from './siteClip';

/**
 * Default terrain seeding from a public DEM (EU-DEM ~25 m): build a sample
 * grid around the site origin, and assemble the returned elevations into a
 * TerrainModel. The actual HTTP fetch lives in the UI/server layer.
 */

export interface SampleGrid {
  /** S-JTSK meters, row-major. */
  sjtsk: { x: number; y: number }[];
  /** Same points as WGS84 for the elevation API. */
  latlon: { lat: number; lon: number }[];
}

/**
 * Grid of sample points covering the site clip rectangle (the property area —
 * see siteClip.ts). The former extent-around-origin parameter is gone: the
 * terrain always spans exactly the clipped map area.
 */
export function terrainSampleGrid(_site: SiteConfig, stepM = 25): SampleGrid {
  const r = siteClipSjtskRect();
  const cols = Math.ceil((r.maxX - r.minX) / stepM) + 1;
  const rows = Math.ceil((r.maxY - r.minY) / stepM) + 1;
  const sjtsk: { x: number; y: number }[] = [];
  const latlon: { lat: number; lon: number }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const p = {
        x: Math.min(r.minX + col * stepM, r.maxX),
        y: Math.min(r.minY + row * stepM, r.maxY)
      };
      sjtsk.push(p);
      latlon.push(sjtskToWgs84(p));
    }
  }
  return { sjtsk, latlon };
}

/**
 * Combine grid points with fetched elevations (meters; null = no data) into a
 * TerrainModel. Returns null when fewer than 3 valid samples came back.
 */
export function terrainFromElevations(
  grid: SampleGrid,
  elevations: (number | null)[]
): TerrainModel | null {
  const xyz: number[] = [];
  for (let i = 0; i < grid.sjtsk.length; i++) {
    const z = elevations[i];
    if (z === null || z === undefined || !isFinite(z)) continue;
    xyz.push(roundMm(grid.sjtsk[i].x), roundMm(grid.sjtsk[i].y), roundMm(z));
  }
  return xyz.length >= 9 ? { xyz } : null;
}
