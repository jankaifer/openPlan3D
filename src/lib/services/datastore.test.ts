import { describe, expect, it } from 'vitest';
import { normalizeProject } from './datastore';
import { JIVINA_90_ORIGIN, jivinaTerrainModel } from '$lib/data/jivinaSite';

function legacyProject(extra: any = {}) {
  return {
    id: 'p1', name: 'Old', floors: [{ id: 'f1', name: 'Ground', level: 0, walls: [] }],
    activeFloorId: 'f1', createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-02T00:00:00Z',
    ...extra
  };
}

describe('normalizeProject', () => {
  it('backfills new floor arrays and site/GIS fields', () => {
    const p = normalizeProject(legacyProject());
    expect(p.floors[0].beams).toEqual([]);
    expect(p.floors[0].slabs).toEqual([]);
    expect(p.floors[0].roofs).toEqual([]);
    expect(p.gisLayers).toEqual([]);
    expect(p.gisFeatures).toEqual([]);
    expect(p.createdAt).toBeInstanceOf(Date);
  });

  it('anchors un-georeferenced projects at Jivina 90 with the built-in terrain', () => {
    // Legacy grid terrain at identity origin gets replaced wholesale — its
    // coordinates are meaningless for the real site.
    const p = normalizeProject(
      legacyProject({
        terrain: {
          origin: { x: 0, y: 0 }, cellSize: 100, cols: 3, rows: 3,
          heights: [0, 10, 20, 30, 40, 50, 60, 70, 80]
        }
      })
    );
    expect(p.terrain).toBeUndefined();
    expect(p.site!.renderOrigin).toEqual(JIVINA_90_ORIGIN);
    expect(p.site!.basemap?.kind).toBe('satellite');
    expect(p.terrainModel).toEqual(jivinaTerrainModel());
  });

  it('leaves an existing terrainModel and site alone', () => {
    const p = normalizeProject(
      legacyProject({
        site: { renderOrigin: { x: -744000, y: -1042000, z: 300 } },
        terrainModel: { xyz: [1, 2, 3] },
        terrain: { origin: { x: 0, y: 0 }, cellSize: 100, cols: 2, rows: 2, heights: [1, 2, 3, 4] }
      })
    );
    expect(p.terrainModel).toEqual({ xyz: [1, 2, 3] });
    expect(p.site!.renderOrigin.x).toBe(-744000);
    expect(p.terrain).toBeUndefined();
  });
});
