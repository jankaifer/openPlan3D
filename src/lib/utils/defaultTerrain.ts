import type { SiteConfig, TerrainModel } from '$lib/models/types';
import { roundMm, sjtskToWgs84 } from './geo';

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

/** Square grid of sample points centered on the site origin. */
export function terrainSampleGrid(site: SiteConfig, extentM = 300, stepM = 25): SampleGrid {
  const o = site.renderOrigin;
  const half = extentM / 2;
  const sjtsk: { x: number; y: number }[] = [];
  const latlon: { lat: number; lon: number }[] = [];
  for (let dy = -half; dy <= half; dy += stepM) {
    for (let dx = -half; dx <= half; dx += stepM) {
      const p = { x: o.x + dx, y: o.y + dy };
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
