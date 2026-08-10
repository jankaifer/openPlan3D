import type { Floor, Point, Terrain } from '$lib/models/types';

/** Axis-aligned plan-space bounds. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Row-major index of a grid sample. */
export function heightIndex(t: Terrain, col: number, row: number): number {
  return row * t.cols + col;
}

/** Nearest grid (col,row) to a plan-space point, clamped to the grid. */
export function nearestGridPoint(t: Terrain, x: number, y: number): { col: number; row: number } {
  const col = Math.max(0, Math.min(t.cols - 1, Math.round((x - t.origin.x) / t.cellSize)));
  const row = Math.max(0, Math.min(t.rows - 1, Math.round((y - t.origin.y) / t.cellSize)));
  return { col, row };
}

/**
 * Grid-point indices whose plan-space position falls within `radius` (cm) of
 * (x, y). A radius smaller than half a cell selects just the nearest point, so
 * single-corner edits are always possible.
 */
export function gridPointsInRadius(t: Terrain, x: number, y: number, radius: number): number[] {
  if (radius < t.cellSize / 2) {
    const { col, row } = nearestGridPoint(t, x, y);
    return [heightIndex(t, col, row)];
  }
  const out: number[] = [];
  const r2 = radius * radius;
  const cMin = Math.max(0, Math.floor((x - radius - t.origin.x) / t.cellSize));
  const cMax = Math.min(t.cols - 1, Math.ceil((x + radius - t.origin.x) / t.cellSize));
  const rMin = Math.max(0, Math.floor((y - radius - t.origin.y) / t.cellSize));
  const rMax = Math.min(t.rows - 1, Math.ceil((y + radius - t.origin.y) / t.cellSize));
  for (let row = rMin; row <= rMax; row++) {
    for (let col = cMin; col <= cMax; col++) {
      const px = t.origin.x + col * t.cellSize;
      const py = t.origin.y + row * t.cellSize;
      if ((px - x) ** 2 + (py - y) ** 2 <= r2) out.push(row * t.cols + col);
    }
  }
  return out;
}

/**
 * Compute the plan-space bounding box of all wall endpoints across every
 * floor. Returns null when there are no walls to bound.
 */
export function computeBuildingBounds(floors: Floor[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;
  const consider = (p: Point) => {
    found = true;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const floor of floors) {
    for (const w of floor.walls) {
      consider(w.start);
      consider(w.end);
      if (w.curvePoint) consider(w.curvePoint);
    }
  }
  return found ? { minX, minY, maxX, maxY } : null;
}

/**
 * Build a terrain grid sized to the building footprint plus a margin. When no
 * building exists yet, falls back to a centered default plot. The grid is
 * quantized to whole cells so it always fully covers `bounds` + `margin`.
 */
export function terrainGridForBounds(
  bounds: Bounds | null,
  opts: { margin?: number; cellSize?: number; fallbackSpan?: number } = {}
): Terrain {
  const margin = opts.margin ?? 1500; // 15 m of plot around the house
  const cellSize = opts.cellSize ?? 25; // match the app's default grid snap (cm)
  const fallbackSpan = opts.fallbackSpan ?? 4000; // 40 m default plot

  let minX: number, minY: number, maxX: number, maxY: number;
  if (bounds) {
    minX = bounds.minX - margin;
    minY = bounds.minY - margin;
    maxX = bounds.maxX + margin;
    maxY = bounds.maxY + margin;
  } else {
    const h = fallbackSpan / 2;
    minX = -h; minY = -h; maxX = h; maxY = h;
  }

  // Snap origin down and span up to whole cells.
  const origin: Point = {
    x: Math.floor(minX / cellSize) * cellSize,
    y: Math.floor(minY / cellSize) * cellSize
  };
  const cols = Math.ceil((maxX - origin.x) / cellSize) + 1;
  const rows = Math.ceil((maxY - origin.y) / cellSize) + 1;

  return { origin, cellSize, cols, rows, heights: new Array(cols * rows).fill(0) };
}

/**
 * Seed a gentle, sculpted-looking test surface: a slope dropping along +X plus
 * a soft mound offset from center. Used in Milestone 1 to confirm terrain
 * renders and lights correctly before the sculpting UI exists.
 */
export function seedTestTerrain(t: Terrain): Terrain {
  const width = (t.cols - 1) * t.cellSize;
  const height = (t.rows - 1) * t.cellSize;
  const grade = 300 / Math.max(width, 1); // ~3 m drop across the plot
  // Mound centered at 35% / 60% of the plot.
  const mx = t.origin.x + width * 0.35;
  const my = t.origin.y + height * 0.6;
  const moundR = Math.max(width, height) * 0.18;
  const moundH = 180; // cm

  const heights = new Array(t.cols * t.rows);
  for (let r = 0; r < t.rows; r++) {
    for (let c = 0; c < t.cols; c++) {
      const x = t.origin.x + c * t.cellSize;
      const y = t.origin.y + r * t.cellSize;
      const slope = -(x - t.origin.x) * grade; // drops toward +X
      const d2 = (x - mx) ** 2 + (y - my) ** 2;
      const mound = moundH * Math.exp(-d2 / (2 * moundR * moundR));
      heights[r * t.cols + c] = slope + mound;
    }
  }
  return { ...t, heights };
}
