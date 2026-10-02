import { describe, expect, it } from 'vitest';
import { irishLocalToUtc, sunPosition } from '@/lib/solar';
import { lonLatToItm } from '@/lib/geo';

describe('solar position', () => {
  it('puts the winter solstice noon sun low in the south over Dublin', () => {
    const p = sunPosition(irishLocalToUtc(2026, 12, 21, 12.4), 53.35, -6.26);
    expect(p.elevation).toBeGreaterThan(12.5);
    expect(p.elevation).toBeLessThan(14);
    expect(Math.abs(p.azimuth - 180)).toBeLessThan(4);
  });

  it('sets around 16:08 in Dublin at the winter solstice', () => {
    const before = sunPosition(irishLocalToUtc(2026, 12, 21, 16.0), 53.35, -6.26);
    const after = sunPosition(irishLocalToUtc(2026, 12, 21, 16.25), 53.35, -6.26);
    expect(before.elevation).toBeGreaterThan(-0.9);
    expect(after.elevation).toBeLessThan(-0.9);
  });

  it('handles Irish summer time', () => {
    expect(irishLocalToUtc(2026, 7, 1, 13).getUTCHours()).toBe(12);
    expect(irishLocalToUtc(2026, 12, 1, 13).getUTCHours()).toBe(13);
  });
});

describe('ITM projection', () => {
  it('maps the projection origin to the false origin', () => {
    const p = lonLatToItm(-8, 53.5);
    expect(p.e).toBeCloseTo(600000, 0);
    expect(p.n).toBeCloseTo(750000, 0);
  });

  it('places Dublin (Spire) within 50 m of its published ITM coordinate', () => {
    // Spire of Dublin, approx. ITM 715,830 E 734,697 N
    const p = lonLatToItm(-6.260273, 53.349805);
    expect(Math.abs(p.e - 715830)).toBeLessThan(50);
    expect(Math.abs(p.n - 734697)).toBeLessThan(50);
  });
});
