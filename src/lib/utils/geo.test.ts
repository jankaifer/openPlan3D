import { describe, expect, it } from 'vitest';
import { makeSite, planFromSjtsk, roundMm, sjtskFromPlan, sjtskToWgs84, wgs84ToSjtsk } from './geo';

// Reference computed with official PROJ 9.8 (`cs2cs EPSG:4326 EPSG:5514`):
// lat 50.2090115556, lon 15.8173041111 → (-642125.990, -1042284.954).
const REF = {
  sjtsk: { x: -642125.99, y: -1042284.954 },
  wgs: { lat: 50.2090115556, lon: 15.8173041111 }
};

describe('S-JTSK ↔ WGS84', () => {
  it('matches PROJ within 20 cm at the reference point', () => {
    const p = wgs84ToSjtsk(REF.wgs);
    expect(Math.hypot(p.x - REF.sjtsk.x, p.y - REF.sjtsk.y)).toBeLessThan(0.2);
    // Czech S-JTSK coordinates are always negative in EPSG:5514.
    expect(p.x).toBeLessThan(0);
    expect(p.y).toBeLessThan(0);
  });

  it('round-trips with cm-level consistency', () => {
    const back = wgs84ToSjtsk(sjtskToWgs84(REF.sjtsk));
    expect(back.x).toBeCloseTo(REF.sjtsk.x, 2);
    expect(back.y).toBeCloseTo(REF.sjtsk.y, 2);
  });
});

describe('plan space', () => {
  const site = makeSite(-744400, -1042700, 320);

  it('maps renderOrigin to plan (0,0,0)', () => {
    expect(planFromSjtsk(site, -744400, -1042700, 320)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('puts north up (larger northing → negative plan Y) and east right, in cm', () => {
    const p = planFromSjtsk(site, -744399, -1042698, 321.5);
    expect(p).toEqual({ x: 100, y: -200, z: 150 });
  });

  it('inverts exactly', () => {
    const s = sjtskFromPlan(site, 123, -456, 78);
    const p = planFromSjtsk(site, s.x, s.y, s.z);
    expect(p.x).toBeCloseTo(123, 6);
    expect(p.y).toBeCloseTo(-456, 6);
    expect(p.z!).toBeCloseTo(78, 6);
  });

  it('roundMm keeps mm precision', () => {
    expect(roundMm(-744400.12345)).toBe(-744400.123);
  });
});
