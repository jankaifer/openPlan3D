import * as THREE from 'three';
import type { SiteConfig } from '$lib/models/types';
import {
  MIN_TILE_Z, TILE_SIZE, groundResolution, maxTileZoom, tileUrl, tilesForPlanRect
} from '$lib/utils/basemap';
import { sjtskToWgs84 } from '$lib/utils/geo';

/**
 * Render adapter: composite basemap tiles covering a plan-space rectangle
 * into a canvas texture draped over the 3D terrain. The terrain geometry's
 * UVs are raw plan cm; the texture's offset/repeat map them onto [0,1] for
 * the covered bounds.
 */

const TEXTURE_PX = 2048;
const imageCache = new Map<string, HTMLImageElement>();

export function buildBasemapTexture(
  site: SiteConfig,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  onUpdate: () => void
): THREE.CanvasTexture | null {
  const basemap = site.basemap;
  const o = site.renderOrigin;
  if (!basemap || (o.x === 0 && o.y === 0)) return null;
  const wCm = maxX - minX, hCm = maxY - minY;
  if (!(wCm > 0) || !(hCm > 0)) return null;

  // Tile zoom matching the texture's ground resolution.
  const lat = sjtskToWgs84({ x: o.x, y: o.y }).lat;
  const long = Math.max(wCm, hCm);
  const targetMetersPerPx = long / 100 / TEXTURE_PX;
  const max = maxTileZoom(basemap.kind);
  let z = MIN_TILE_Z;
  while (z < max && groundResolution(lat, z) > targetMetersPerPx) z++;
  let tiles = tilesForPlanRect(site, minX, minY, maxX, maxY, z);
  while (!tiles.length && z > MIN_TILE_Z) tiles = tilesForPlanRect(site, minX, minY, maxX, maxY, --z);
  if (!tiles.length) return null;

  const scale = TEXTURE_PX / long; // canvas px per plan cm
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(wCm * scale));
  canvas.height = Math.max(1, Math.round(hCm * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#9aa39a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false; // canvas row 0 = minY (north edge); v = (y - minY) / h
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(1 / wCm, 1 / hCm);
  texture.offset.set(-minX / wCm, -minY / hCm);
  texture.anisotropy = 4;

  const drawTile = (t: { nw: any; ne: any; sw: any }, img: HTMLImageElement) => {
    const nw = { x: (t.nw.x - minX) * scale, y: (t.nw.y - minY) * scale };
    const ne = { x: (t.ne.x - minX) * scale, y: (t.ne.y - minY) * scale };
    const sw = { x: (t.sw.x - minX) * scale, y: (t.sw.y - minY) * scale };
    ctx.setTransform(
      (ne.x - nw.x) / TILE_SIZE, (ne.y - nw.y) / TILE_SIZE,
      (sw.x - nw.x) / TILE_SIZE, (sw.y - nw.y) / TILE_SIZE,
      nw.x, nw.y
    );
    ctx.drawImage(img, -0.5, -0.5, TILE_SIZE + 1, TILE_SIZE + 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  for (const t of tiles) {
    const url = tileUrl(basemap.kind, t.z, t.x, t.y);
    const cached = imageCache.get(url);
    if (cached && cached.complete && cached.naturalWidth > 0) {
      drawTile(t, cached);
      continue;
    }
    const img = cached ?? new Image();
    if (!cached) {
      img.crossOrigin = 'anonymous';
      img.src = url;
      imageCache.set(url, img);
    }
    img.addEventListener('load', () => {
      drawTile(t, img);
      texture.needsUpdate = true;
      onUpdate();
    });
  }
  texture.needsUpdate = true;
  return texture;
}
