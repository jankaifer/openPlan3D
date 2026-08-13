import { describe, expect, it } from 'vitest';
import { parseRtkPoints, terrainFromRtk } from './rtkImport';
import { wgs84ToSjtsk } from './geo';

describe('parseRtkPoints', () => {
  it('parses negative EPSG:5514 triples with headers and name columns', () => {
    const text = [
      '# survey 2026-08-12',
      'name,x,y,h',
      'bod1,-744123.456,-1042567.890,321.451',
      'bod2,-744120.100,-1042565.000,321.902',
      'bod3;-744118.500;-1042569.250;322.010'
    ].join('\n');
    const r = parseRtkPoints(text)!;
    expect(r.format).toBe('sjtsk');
    expect(r.xyz).toEqual([
      -744123.456, -1042567.89, 321.451,
      -744120.1, -1042565, 321.902,
      -744118.5, -1042569.25, 322.01
    ]);
    expect(r.skipped).toBe(2);
  });

  it('converts Krovak positive Y X H convention to EPSG:5514', () => {
    const text = '744123.456 1042567.890 321.45\n744120 1042565 321.90\n744118 1042569 322.01';
    const r = parseRtkPoints(text)!;
    expect(r.format).toBe('krovak-positive');
    expect(r.xyz[0]).toBe(-744123.456);
    expect(r.xyz[1]).toBe(-1042567.89);
  });

  it('projects WGS84 lat lon height lines', () => {
    const text = '50.2090115556\t15.8173041111\t245.3\n50.2091\t15.8174\t245.9\n50.2092\t15.8175\t246.1';
    const r = parseRtkPoints(text)!;
    expect(r.format).toBe('wgs84');
    const p = wgs84ToSjtsk({ lat: 50.2090115556, lon: 15.8173041111 });
    expect(r.xyz[0]).toBeCloseTo(p.x, 3);
    expect(r.xyz[1]).toBeCloseTo(p.y, 3);
    expect(r.xyz[2]).toBe(245.3);
  });

  it('rejects files without at least 3 valid points', () => {
    expect(parseRtkPoints('hello\nworld')).toBeNull();
    expect(parseRtkPoints('-744123.4 -1042567.8 321.4')).toBeNull();
  });
});

describe('terrainFromRtk', () => {
  it('centers a new render origin on the cloud, whole meters', () => {
    const parsed = parseRtkPoints(
      '-744100 -1042500 320.2\n-744200 -1042600 324.8\n-744150 -1042550 322.5'
    )!;
    const { site, terrainModel } = terrainFromRtk(parsed);
    expect(site.renderOrigin).toEqual({ x: -744150, y: -1042550, z: 320 });
    expect(terrainModel.xyz).toHaveLength(9);
  });

  it('keeps an existing site untouched', () => {
    const parsed = parseRtkPoints(
      '-744100 -1042500 320.2\n-744200 -1042600 324.8\n-744150 -1042550 322.5'
    )!;
    const existing = { renderOrigin: { x: -744000, y: -1042000, z: 300 } };
    expect(terrainFromRtk(parsed, existing).site).toBe(existing);
  });
});
