import proj4 from 'proj4';
import type { SiteConfig } from '$lib/models/types';

/**
 * Coordinate conventions for the whole app — THE single place they live:
 *
 * - Site geometry (terrain points, GIS features) is stored in
 *   S-JTSK / Krovak East North (EPSG:5514) meters: x = easting, y = northing
 *   (both negative in Czechia), z = Bpv elevation in meters.
 * - "Plan space" is what the 2D canvas and 3D scene use: centimeters relative
 *   to `site.renderOrigin`, plan X = east, plan Y = **south** (canvas Y grows
 *   downward, so north points up on screen). Plan/3D elevation is cm above
 *   renderOrigin.z.
 */

/**
 * S-JTSK / Krovak East North (EPSG:5514) with the 7-parameter Czech
 * Bessel→WGS84 shift — matches PROJ's authoritative transform to ~5 cm.
 */
const SJTSK =
  '+proj=krovak +lat_0=49.5 +lon_0=24.833333333333332 ' +
  '+alpha=30.288139722222223 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel ' +
  '+towgs84=570.8,85.7,462.8,4.998,1.587,5.261,3.56 +units=m +no_defs';
const WGS84 = 'EPSG:4326';

export interface SjtskPoint { x: number; y: number; }
export interface LatLon { lat: number; lon: number; }

export function wgs84ToSjtsk(p: LatLon): SjtskPoint {
  const [x, y] = proj4(WGS84, SJTSK, [p.lon, p.lat]);
  return { x, y };
}

export function sjtskToWgs84(p: SjtskPoint): LatLon {
  const [lon, lat] = proj4(SJTSK, WGS84, [p.x, p.y]);
  return { lat, lon };
}

export interface PlanPoint { x: number; y: number; z?: number; }

/** S-JTSK meters (+ optional Bpv z) → plan-space cm relative to renderOrigin. */
export function planFromSjtsk(site: SiteConfig, x: number, y: number, z?: number): PlanPoint {
  const o = site.renderOrigin;
  return {
    x: (x - o.x) * 100,
    y: (o.y - y) * 100,
    ...(z !== undefined ? { z: (z - o.z) * 100 } : {})
  };
}

/** Plan-space cm → S-JTSK meters (+ Bpv z when plan z given). */
export function sjtskFromPlan(site: SiteConfig, px: number, py: number, pz?: number): { x: number; y: number; z?: number } {
  const o = site.renderOrigin;
  return {
    x: o.x + px / 100,
    y: o.y - py / 100,
    ...(pz !== undefined ? { z: o.z + pz / 100 } : {})
  };
}

/** Round an S-JTSK meter coordinate to mm — storage precision for survey data. */
export function roundMm(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Default site placing the plan origin at the given S-JTSK point. */
export function makeSite(x: number, y: number, z: number): SiteConfig {
  return { renderOrigin: { x: roundMm(x), y: roundMm(y), z: roundMm(z) } };
}
