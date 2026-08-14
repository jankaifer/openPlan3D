import type { Project } from '$lib/models/types';
import {
  MIN_TILE_Z, TILE_SIZE, basemapAttribution, pickTileZoom, tileUrl, tilesForPlanRect
} from '$lib/utils/basemap';
import { sjtskToWgs84 } from '$lib/utils/geo';

/**
 * Canvas adapter: draws web-mercator basemap tiles under the plan. All tile
 * math lives in utils/basemap.ts; this file only loads images and issues
 * drawImage calls (with an affine transform per tile — Krovak is slightly
 * rotated relative to mercator north).
 */

interface ViewTransform { camX: number; camY: number; zoom: number; width: number; height: number; }

const tileCache = new Map<string, HTMLImageElement>();
const failed = new Set<string>();
let cachePruneCounter = 0;

function getTile(url: string, onLoad: () => void): HTMLImageElement | null {
  const cached = tileCache.get(url);
  if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
  if (failed.has(url)) return null;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = onLoad;
  img.onerror = () => failed.add(url);
  img.src = url;
  tileCache.set(url, img);
  if (++cachePruneCounter % 64 === 0 && tileCache.size > 512) {
    for (const key of [...tileCache.keys()].slice(0, 256)) tileCache.delete(key);
  }
  return null;
}

export function drawBasemap(
  ctx: CanvasRenderingContext2D,
  vt: ViewTransform,
  project: Project,
  onTileLoaded: () => void
): void {
  const site = project.site;
  const basemap = site?.basemap;
  if (!site || !basemap) return;
  const o = site.renderOrigin;
  if (o.x === 0 && o.y === 0) return;

  const toScreen = (wx: number, wy: number) => ({
    x: (wx - vt.camX) * vt.zoom + vt.width / 2,
    y: (wy - vt.camY) * vt.zoom + vt.height / 2
  });
  // Visible plan rect (cm).
  const minX = vt.camX - vt.width / 2 / vt.zoom;
  const maxX = vt.camX + vt.width / 2 / vt.zoom;
  const minY = vt.camY - vt.height / 2 / vt.zoom;
  const maxY = vt.camY + vt.height / 2 / vt.zoom;

  const lat = sjtskToWgs84({ x: o.x, y: o.y }).lat;
  // Wide views can exceed the per-view tile cap at the resolution-matched
  // zoom (tilesForPlanRect returns []); fall back to coarser tiles until
  // the view fits.
  let z = pickTileZoom(lat, vt.zoom, basemap.kind);
  let tiles = tilesForPlanRect(site, minX, minY, maxX, maxY, z);
  while (!tiles.length && z > MIN_TILE_Z) tiles = tilesForPlanRect(site, minX, minY, maxX, maxY, --z);

  ctx.save();
  ctx.globalAlpha = basemap.opacity ?? 1;
  for (const t of tiles) {
    const img = getTile(tileUrl(basemap.kind, t.z, t.x, t.y), onTileLoaded);
    if (!img) continue;
    const nw = toScreen(t.nw.x, t.nw.y);
    const ne = toScreen(t.ne.x, t.ne.y);
    const sw = toScreen(t.sw.x, t.sw.y);
    // Affine mapping tile pixel space (TILE_SIZE²) onto the nw/ne/sw quad.
    ctx.setTransform(
      (ne.x - nw.x) / TILE_SIZE, (ne.y - nw.y) / TILE_SIZE,
      (sw.x - nw.x) / TILE_SIZE, (sw.y - nw.y) / TILE_SIZE,
      nw.x, nw.y
    );
    // Overdraw 0.5px to hide seams between tiles.
    ctx.drawImage(img, -0.5, -0.5, TILE_SIZE + 1, TILE_SIZE + 1);
  }
  ctx.restore();

  // Attribution (required by both imagery sources).
  ctx.save();
  ctx.font = '10px sans-serif';
  const label = basemapAttribution(basemap.kind);
  const w = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(vt.width - w - 10, vt.height - 16, w + 10, 16);
  ctx.fillStyle = '#475569';
  ctx.fillText(label, vt.width - w - 5, vt.height - 5);
  ctx.restore();
}
