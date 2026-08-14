import type { SiteConfig } from '$lib/models/types';
import { planFromSjtsk, sjtskFromPlan, sjtskToWgs84, wgs84ToSjtsk } from './geo';

/**
 * Web-mercator (XYZ) tile math for background basemaps, in pure data terms:
 * given a site georeference and a plan-space view rectangle, produce the set
 * of tiles to draw and their corner positions in plan cm. Rendering the
 * actual images is the adapter's job (basemapRenderer.ts).
 */

export type BasemapKind = 'satellite' | 'osm';

export const TILE_SIZE = 256;
export const MIN_TILE_Z = 2;
/**
 * Esri World Imagery serves "map data not yet available" placeholder tiles
 * beyond z18 in rural Czechia, so cap satellite there; deeper canvas zooms
 * just upscale the z18 imagery via the placement transform.
 */
export function maxTileZoom(kind: BasemapKind): number {
  return kind === 'satellite' ? 18 : 19;
}
/** Safety cap so a zoomed-out view never requests hundreds of tiles. */
export const MAX_TILES_PER_VIEW = 64;

export function tileUrl(kind: BasemapKind, z: number, x: number, y: number): string {
  if (kind === 'satellite') {
    // Esri World Imagery (free for development/small-scale use).
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  }
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

export function basemapAttribution(kind: BasemapKind): string {
  return kind === 'satellite'
    ? 'Imagery © Esri, Maxar, Earthstar Geographics'
    : '© OpenStreetMap contributors';
}

/** Fractional XYZ tile coordinates of a lon/lat at zoom z. */
export function lonLatToTileFrac(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  };
}

/** Lon/lat of a (possibly fractional) tile coordinate's NW corner. */
export function tileToLonLat(tx: number, ty: number, z: number): { lon: number; lat: number } {
  const n = 2 ** z;
  const lon = (tx / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return { lon, lat };
}

/** Ground resolution of a tile pixel at latitude, in meters/pixel. */
export function groundResolution(latDeg: number, z: number): number {
  return (156543.03392 * Math.cos((latDeg * Math.PI) / 180)) / 2 ** z;
}

/**
 * Pick the tile zoom whose ground resolution best matches the canvas zoom
 * (`canvasZoom` = screen px per plan cm, so 100*canvasZoom px per meter).
 */
export function pickTileZoom(latDeg: number, canvasZoom: number, kind: BasemapKind = 'satellite'): number {
  const targetMetersPerPx = 1 / (100 * canvasZoom);
  const max = maxTileZoom(kind);
  let z = MIN_TILE_Z;
  while (z < max && groundResolution(latDeg, z) > targetMetersPerPx) z++;
  return z;
}

export interface TilePlacement {
  z: number;
  x: number;
  y: number;
  /** Tile corner positions in plan-space cm. */
  nw: { x: number; y: number };
  ne: { x: number; y: number };
  sw: { x: number; y: number };
}

function planFromTile(site: SiteConfig, tx: number, ty: number, z: number): { x: number; y: number } {
  const { lon, lat } = tileToLonLat(tx, ty, z);
  const s = wgs84ToSjtsk({ lat, lon });
  const p = planFromSjtsk(site, s.x, s.y);
  return { x: p.x, y: p.y };
}

/**
 * Tiles covering a plan-space rectangle (cm). Returns [] when the site is not
 * georeferenced (identity origin) or the request would exceed the tile cap.
 */
export function tilesForPlanRect(
  site: SiteConfig,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  z: number
): TilePlacement[] {
  const o = site.renderOrigin;
  if (o.x === 0 && o.y === 0) return [];
  // Plan rect corners → lon/lat bounds (Krovak is rotated vs. mercator, so
  // take min/max over all four corners).
  const corners = [
    [minX, minY], [maxX, minY], [minX, maxY], [maxX, maxY]
  ].map(([px, py]) => {
    const s = sjtskFromPlan(site, px, py);
    return sjtskToWgs84({ x: s.x, y: s.y });
  });
  const lons = corners.map((c) => c.lon);
  const lats = corners.map((c) => c.lat);
  const a = lonLatToTileFrac(Math.min(...lons), Math.max(...lats), z);
  const b = lonLatToTileFrac(Math.max(...lons), Math.min(...lats), z);
  const x0 = Math.floor(a.x), x1 = Math.floor(b.x);
  const y0 = Math.floor(a.y), y1 = Math.floor(b.y);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES_PER_VIEW) return [];
  const n = 2 ** z;
  const tiles: TilePlacement[] = [];
  for (let ty = Math.max(0, y0); ty <= Math.min(n - 1, y1); ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const wx = ((tx % n) + n) % n; // wrap longitude
      tiles.push({
        z, x: wx, y: ty,
        nw: planFromTile(site, tx, ty, z),
        ne: planFromTile(site, tx + 1, ty, z),
        sw: planFromTile(site, tx, ty + 1, z)
      });
    }
  }
  return tiles;
}
