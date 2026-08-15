import type { SiteConfig } from '$lib/models/types';
import type { Bounds } from './terrain';
import { planFromSjtsk, wgs84ToSjtsk } from './geo';

/**
 * The app is intentionally site-specific: everything map-related (basemap
 * tiles, DEM terrain, drape textures) is clipped to the minimal WGS84
 * rectangle around Jan's property markers (mapy.com/s/medolozaha — Jivina 95,
 * Beroun district). Roughly 740 m × 780 m.
 */
export const SITE_CLIP_WGS84 = {
  minLat: 49.796122,
  maxLat: 49.803116,
  minLon: 13.828383,
  maxLon: 13.838683
};

/** Clip rectangle as an S-JTSK-meter AABB (site-independent). */
export function siteClipSjtskRect(): Bounds {
  const r = SITE_CLIP_WGS84;
  const corners = [
    { lat: r.minLat, lon: r.minLon },
    { lat: r.minLat, lon: r.maxLon },
    { lat: r.maxLat, lon: r.minLon },
    { lat: r.maxLat, lon: r.maxLon }
  ].map(wgs84ToSjtsk);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  };
}

/**
 * Clip rectangle as a plan-space (cm) AABB for a georeferenced site, or null
 * when the site has no georeference yet.
 */
export function siteClipPlanRect(site: SiteConfig): Bounds | null {
  const o = site.renderOrigin;
  if (o.x === 0 && o.y === 0) return null;
  const s = siteClipSjtskRect();
  const corners = [
    [s.minX, s.minY], [s.maxX, s.minY], [s.minX, s.maxY], [s.maxX, s.maxY]
  ].map(([x, y]) => planFromSjtsk(site, x, y));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  };
}

/** Intersection of two AABBs, or null when they do not overlap. */
export function intersectBounds(a: Bounds, b: Bounds): Bounds | null {
  const minX = Math.max(a.minX, b.minX);
  const minY = Math.max(a.minY, b.minY);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxY = Math.min(a.maxY, b.maxY);
  return maxX > minX && maxY > minY ? { minX, minY, maxX, maxY } : null;
}
