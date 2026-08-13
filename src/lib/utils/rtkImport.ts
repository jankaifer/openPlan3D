import type { SiteConfig, TerrainModel } from '$lib/models/types';
import { makeSite, roundMm, wgs84ToSjtsk } from './geo';
import { terrainBounds } from './tin';

/**
 * Parse RTK survey point files (plain text) into terrain points. Pure
 * (text in → data out): the UI reads the File and passes a string.
 *
 * Supported per-line shapes (delimiter: comma, semicolon, tab or spaces;
 * non-numeric name/code columns are ignored; header lines are skipped):
 *  - S-JTSK EPSG:5514:  -744123.456  -1042567.890  321.45   (negative pair)
 *  - S-JTSK Krovak positive convention: Y(easting) X(southing) H, e.g.
 *    744123.456 1042567.890 321.45 → converted to (-Y, -X)
 *  - WGS84: lat lon height (degrees in Czech range) → projected to S-JTSK
 */

export interface RtkParseResult {
  /** Detected input format of the coordinates. */
  format: 'sjtsk' | 'krovak-positive' | 'wgs84';
  /** Terrain point triples, S-JTSK meters, mm-rounded. */
  xyz: number[];
  /** Count of lines skipped as non-data (headers, comments, malformed). */
  skipped: number;
}

const NUM = /^[+-]?\d+(?:\.\d+)?$/;

function numericFields(line: string): number[] {
  return line
    .split(/[,;\t ]+/)
    .filter((f) => NUM.test(f))
    .map(Number);
}

function classify(nums: number[]): RtkParseResult['format'] | null {
  if (nums.length < 3) return null;
  const [a, b] = nums;
  if (a < -400000 && a > -910000 && b < -930000 && b > -1240000) return 'sjtsk';
  if (a > 400000 && a < 910000 && b > 930000 && b < 1240000) return 'krovak-positive';
  // Czech lat/lon window, lat first (the common GNSS export order).
  if (a > 48 && a < 52 && b > 12 && b < 19) return 'wgs84';
  return null;
}

export function parseRtkPoints(text: string): RtkParseResult | null {
  const lines = text.split(/\r?\n/);
  let format: RtkParseResult['format'] | null = null;
  const xyz: number[] = [];
  let skipped = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) { skipped++; continue; }
    const nums = numericFields(trimmed);
    const kind = classify(nums);
    if (!kind || (format && kind !== format)) { skipped++; continue; }
    format = kind;
    const [a, b, z] = nums;
    if (kind === 'sjtsk') xyz.push(roundMm(a), roundMm(b), roundMm(z));
    else if (kind === 'krovak-positive') xyz.push(roundMm(-a), roundMm(-b), roundMm(z));
    else {
      const p = wgs84ToSjtsk({ lat: a, lon: b });
      xyz.push(roundMm(p.x), roundMm(p.y), roundMm(z));
    }
  }
  if (!format || xyz.length < 9) return null;
  return { format, xyz, skipped };
}

/**
 * Build the project terrain from parsed points. When the project has no site
 * yet, a render origin is placed at the point-cloud center (rounded to whole
 * meters) so plan coordinates start near zero.
 */
export function terrainFromRtk(
  parsed: RtkParseResult,
  existingSite?: SiteConfig
): { site: SiteConfig; terrainModel: TerrainModel } {
  const b = terrainBounds(parsed.xyz)!;
  const site =
    existingSite ??
    makeSite(
      Math.round((b.minX + b.maxX) / 2),
      Math.round((b.minY + b.maxY) / 2),
      Math.round(b.minZ)
    );
  return { site, terrainModel: { xyz: parsed.xyz } };
}
