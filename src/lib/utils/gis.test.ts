import { describe, expect, it } from 'vitest';
import type { GisFeature } from '$lib/models/types';
import { featureArea, featureLength, featurePlanVertices, makeFeature, makeLayer, vertexElevation } from './gis';
import { buildTin } from './tin';

const flatTin = buildTin([0, 0, 100, 20, 0, 100, 0, 20, 100, 20, 20, 100])!;

function line(vertices: GisFeature['vertices'], depth?: number): GisFeature {
  return { id: 'f1', layerId: 'l1', kind: 'line', vertices, ...(depth !== undefined ? { depth } : {}) };
}

describe('vertexElevation', () => {
  it('uses explicit z when set', () => {
    expect(vertexElevation(line([{ x: 5, y: 5, z: 314.2 }]), 0, flatTin)).toBe(314.2);
  });

  it('depth puts the vertex below the terrain surface (cm)', () => {
    expect(vertexElevation(line([{ x: 5, y: 5 }], 80), 0, flatTin)).toBeCloseTo(99.2, 9);
  });

  it('defaults to the terrain surface, or 0 without terrain', () => {
    expect(vertexElevation(line([{ x: 5, y: 5 }]), 0, flatTin)).toBe(100);
    expect(vertexElevation(line([{ x: 5, y: 5 }]), 0, null)).toBe(0);
  });
});

describe('featurePlanVertices', () => {
  it('converts to plan cm with resolved elevation', () => {
    const site = { renderOrigin: { x: 0, y: 0, z: 100 } };
    const [p] = featurePlanVertices(line([{ x: 5, y: 5 }], 80), site, flatTin);
    expect(p.x).toBe(500);
    expect(p.y).toBe(-500);
    expect(p.z).toBeCloseTo(-80, 9);
  });
});

describe('measures', () => {
  it('featureLength sums segments (and closes polygons)', () => {
    expect(featureLength(line([{ x: 0, y: 0 }, { x: 3, y: 4 }]))).toBe(5);
    const poly: GisFeature = { id: 'p', layerId: 'l', kind: 'polygon', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] };
    expect(featureLength(poly)).toBe(40);
    expect(featureArea(poly)).toBe(100);
  });
});

describe('constructors', () => {
  it('make unique ids and cycle layer colors', () => {
    const l1 = makeLayer('Water', []);
    const l2 = makeLayer('Electricity', [l1]);
    expect(l1.id).not.toBe(l2.id);
    expect(l1.color).not.toBe(l2.color);
    const f = makeFeature(l1.id, 'point');
    expect(f.layerId).toBe(l1.id);
    expect(f.vertices).toEqual([]);
  });
});
