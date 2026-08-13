import type { GisFeature, GisLayer, Project, SiteConfig } from '$lib/models/types';
import { planFromSjtsk } from '$lib/utils/geo';
import { buildTin, type Tin } from '$lib/utils/tin';
import { contoursFromTin, type ContourLevel } from '$lib/utils/contours';

/**
 * 2D canvas drawing of the site layers: terrain contours + GIS features.
 * Same world→screen convention as canvasRenderer.ts:
 *   sx = (wx - camX) * zoom + width/2
 */

export interface ViewTransform {
  camX: number;
  camY: number;
  zoom: number;
  width: number;
  height: number;
}

function sx(t: ViewTransform, wx: number) { return (wx - t.camX) * t.zoom + t.width / 2; }
function sy(t: ViewTransform, wy: number) { return (wy - t.camY) * t.zoom + t.height / 2; }

// Contours are recomputed only when the terrain array identity changes.
let cachedXyz: number[] | null = null;
let cachedInterval = 0;
let cachedTin: Tin | null = null;
let cachedContours: ContourLevel[] = [];

/** TIN for the project's terrain (cached; also used for elevation readouts). */
export function projectTin(project: Project): Tin | null {
  const xyz = project.terrainModel?.xyz;
  if (!xyz || xyz.length < 9) return null;
  if (xyz !== cachedXyz) {
    cachedXyz = xyz;
    cachedTin = buildTin(xyz);
    cachedContours = [];
    cachedInterval = 0;
  }
  return cachedTin;
}

export function drawContours(
  ctx: CanvasRenderingContext2D,
  t: ViewTransform,
  project: Project,
  interval: number
) {
  const tin = projectTin(project);
  const site = project.site;
  if (!tin || !site) return;
  if (interval !== cachedInterval || cachedContours.length === 0) {
    cachedContours = contoursFromTin(tin, interval);
    cachedInterval = interval;
  }
  ctx.save();
  for (const { level, segments } of cachedContours) {
    const major = Math.abs(level / interval) % 5 < 1e-9; // every 5th line stronger
    ctx.strokeStyle = major ? 'rgba(146, 104, 62, 0.55)' : 'rgba(146, 104, 62, 0.28)';
    ctx.lineWidth = major ? 1.5 : 1;
    ctx.beginPath();
    for (let s = 0; s < segments.length; s += 4) {
      const a = planFromSjtsk(site, segments[s], segments[s + 1]);
      const b = planFromSjtsk(site, segments[s + 2], segments[s + 3]);
      ctx.moveTo(sx(t, a.x), sy(t, a.y));
      ctx.lineTo(sx(t, b.x), sy(t, b.y));
    }
    ctx.stroke();
  }
  ctx.restore();
}

function applyLineStyle(ctx: CanvasRenderingContext2D, layer: GisLayer, zoom: number) {
  ctx.strokeStyle = layer.color;
  ctx.lineWidth = Math.max(2, 3 * zoom);
  if (layer.lineStyle === 'dashed') ctx.setLineDash([10, 6]);
  else if (layer.lineStyle === 'dotted') ctx.setLineDash([2, 5]);
  else ctx.setLineDash([]);
}

export function drawGisFeatures(
  ctx: CanvasRenderingContext2D,
  t: ViewTransform,
  project: Project,
  opts: { selectedId?: string | null; draftId?: string | null } = {}
) {
  const site = project.site;
  const layers = project.gisLayers ?? [];
  const features = project.gisFeatures ?? [];
  if (!site || features.length === 0) return;
  const layerById = new Map(layers.map((l) => [l.id, l]));

  ctx.save();
  for (const f of features) {
    const layer = layerById.get(f.layerId);
    if (!layer || !layer.visible || f.vertices.length === 0) continue;
    const pts = f.vertices.map((v) => {
      const p = planFromSjtsk(site, v.x, v.y);
      return { x: sx(t, p.x), y: sy(t, p.y) };
    });
    const selected = f.id === opts.selectedId || f.id === opts.draftId;

    if (f.kind !== 'point' && pts.length >= 2) {
      applyLineStyle(ctx, layer, t.zoom);
      if (selected) ctx.lineWidth += 2;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (f.kind === 'polygon' && f.id !== opts.draftId) ctx.closePath();
      ctx.stroke();
      if (f.kind === 'polygon' && pts.length >= 3) {
        ctx.fillStyle = layer.color + '22';
        ctx.fill();
      }
      ctx.setLineDash([]);
    }

    // Vertex markers: always for points/drafts/selection, small dots otherwise.
    const r = f.kind === 'point' ? 6 : selected ? 4 : 2.5;
    ctx.fillStyle = layer.color;
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (f.kind === 'point' || selected) {
        ctx.strokeStyle = '#ffffff';
        ctx.setLineDash([]);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    if (f.label && pts.length > 0) {
      ctx.fillStyle = layer.color;
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(f.label, pts[0].x + 8, pts[0].y - 8);
    }
    if (f.depth !== undefined && pts.length > 0) {
      ctx.fillStyle = layer.color;
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(`−${(f.depth / 100).toFixed(2)} m`, pts[0].x + 8, pts[0].y + 14);
    }
  }
  ctx.restore();
}

/** Hit-test GIS features at a plan-space point (cm); returns the feature id. */
export function findGisFeatureAt(
  project: Project,
  planX: number,
  planY: number,
  tolerance: number
): string | null {
  const site = project.site;
  if (!site) return null;
  const layers = new Map((project.gisLayers ?? []).map((l) => [l.id, l]));
  const features = project.gisFeatures ?? [];
  for (let fi = features.length - 1; fi >= 0; fi--) {
    const f = features[fi];
    const layer = layers.get(f.layerId);
    if (!layer?.visible || layer.locked) continue;
    const pts = f.vertices.map((v) => planFromSjtsk(site, v.x, v.y));
    for (const p of pts) {
      if (Math.hypot(p.x - planX, p.y - planY) <= tolerance) return f.id;
    }
    if (f.kind !== 'point') {
      const n = f.kind === 'polygon' ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const s = len2 > 0 ? Math.max(0, Math.min(1, ((planX - a.x) * dx + (planY - a.y) * dy) / len2)) : 0;
        if (Math.hypot(a.x + s * dx - planX, a.y + s * dy - planY) <= tolerance) return f.id;
      }
    }
  }
  return null;
}
