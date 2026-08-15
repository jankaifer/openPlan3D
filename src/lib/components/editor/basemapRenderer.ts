import type { Project } from '$lib/models/types';
import {
  TILE_SIZE, basemapAttribution, fixedBasemapTiles, tileUrl, type TilePlacement
} from '$lib/utils/basemap';
import { siteClipPlanRect } from '$lib/utils/siteClip';

/**
 * Canvas adapter: draws web-mercator basemap tiles under the plan. All tile
 * math lives in utils/basemap.ts; this file only loads images and issues
 * drawImage calls (with an affine transform per tile — Krovak is slightly
 * rotated relative to mercator north).
 *
 * The map coverage is a FIXED pyramid around the site origin (coarse far,
 * fine near), independent of camera position and zoom — the camera only
 * decides which part of it is on screen. Levels draw coarse→fine so the
 * detailed imagery sits on top near the site.
 */

interface ViewTransform { camX: number; camY: number; zoom: number; width: number; height: number; }

const tileCache = new Map<string, HTMLImageElement>();
const failed = new Set<string>();

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
  return null;
}

// Fixed tile pyramid, cached per site origin + basemap kind.
let placementKey = '';
let placements: TilePlacement[] = [];

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

  const key = `${basemap.kind}|${o.x},${o.y}`;
  if (key !== placementKey) {
    placements = fixedBasemapTiles(site);
    placementKey = key;
  }

  const toScreen = (wx: number, wy: number) => ({
    x: (wx - vt.camX) * vt.zoom + vt.width / 2,
    y: (wy - vt.camY) * vt.zoom + vt.height / 2
  });

  ctx.save();
  ctx.globalAlpha = basemap.opacity ?? 1;
  // Hard-clip drawing to the site rectangle — tiles are whole squares and
  // overhang it, but no imagery should show outside the property area.
  const clip = siteClipPlanRect(site);
  if (clip) {
    const a = toScreen(clip.minX, clip.minY);
    const b = toScreen(clip.maxX, clip.maxY);
    ctx.beginPath();
    ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.clip();
  }
  for (const t of placements) {
    const nw = toScreen(t.nw.x, t.nw.y);
    const ne = toScreen(t.ne.x, t.ne.y);
    const sw = toScreen(t.sw.x, t.sw.y);
    const se = { x: ne.x + sw.x - nw.x, y: ne.y + sw.y - nw.y };
    // Cull tiles fully off screen; skip sub-pixel tiles (coarser level covers).
    const sMinX = Math.min(nw.x, ne.x, sw.x, se.x), sMaxX = Math.max(nw.x, ne.x, sw.x, se.x);
    const sMinY = Math.min(nw.y, ne.y, sw.y, se.y), sMaxY = Math.max(nw.y, ne.y, sw.y, se.y);
    if (sMaxX < 0 || sMinX > vt.width || sMaxY < 0 || sMinY > vt.height) continue;
    if (sMaxX - sMinX < 2) continue;
    const img = getTile(tileUrl(basemap.kind, t.z, t.x, t.y), onTileLoaded);
    if (!img) continue;
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
