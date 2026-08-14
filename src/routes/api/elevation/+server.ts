import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const BATCH = 100; // opentopodata public API limit per request
const DELAY_MS = 1100; // and max 1 call/second

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Proxy EU-DEM (~25 m) elevations from opentopodata for a list of WGS84
 * points. POST body: { locations: [{lat, lon}, …] } (max 2500).
 * Returns { elevations: (number|null)[] } in the same order.
 */
export const POST: RequestHandler = async ({ request, fetch }) => {
  const body = await request.json().catch(() => null);
  const locations = body?.locations as { lat: number; lon: number }[] | undefined;
  if (!Array.isArray(locations) || locations.length === 0) throw error(400, 'missing locations');
  if (locations.length > 2500) throw error(400, 'too many locations (max 2500)');

  const elevations: (number | null)[] = [];
  for (let i = 0; i < locations.length; i += BATCH) {
    if (i > 0) await sleep(DELAY_MS);
    const chunk = locations.slice(i, i + BATCH);
    const locs = chunk.map((l) => `${l.lat.toFixed(7)},${l.lon.toFixed(7)}`).join('|');
    const res = await fetch(`https://api.opentopodata.org/v1/eudem25m?locations=${locs}`);
    if (!res.ok) throw error(502, `elevation API returned ${res.status}`);
    const data = await res.json();
    if (data.status !== 'OK') throw error(502, `elevation API: ${data.status}`);
    for (const r of data.results) elevations.push(typeof r.elevation === 'number' ? r.elevation : null);
  }
  return json({ elevations });
};
