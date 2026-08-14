import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Proxy Nominatim geocoding (avoids browser CORS + centralizes the UA). */
export const GET: RequestHandler = async ({ url, fetch }) => {
  const q = url.searchParams.get('q')?.trim();
  if (!q) throw error(400, 'missing q');
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&countrycodes=cz`,
    { headers: { 'User-Agent': 'openPlan3D homestead planner (claude@kaifer.cz)' } }
  );
  if (!res.ok) throw error(502, `geocoder returned ${res.status}`);
  const results = (await res.json()) as any[];
  return json(
    results.map((r) => ({
      lat: Number(r.lat),
      lon: Number(r.lon),
      displayName: r.display_name as string
    }))
  );
};
