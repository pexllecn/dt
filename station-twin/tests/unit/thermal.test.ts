/** IEC 60076-7 model: steady state, dynamics, cooling control, ageing. */
import { describe, expect, it } from 'vitest';
import { THERMAL } from '../../src/config/assumptions.ts';
import { ageingRate, coolingMode, iecStep, nextStage, steadyState } from '../../src/sim/thermal/iec60076.ts';

describe('IEC 60076-7 thermal model', () => {
  const healthyOF = coolingMode({ coolingType: 'OFAF', pumpFailed: false, stage: 2 });

  it('gives the design hot-spot of 98 °C at rated load and 20 °C ambient', () => {
    const ss = steadyState(healthyOF, 1.0, 20);
    expect(ss.topOil).toBeCloseTo(20 + THERMAL.OF.value.topOilRiseK, 9);
    expect(ss.hotSpot).toBeCloseTo(98, 9);
  });

  it('matches a hand calculation at 1.24 per unit (N-1 at baseline)', () => {
    // top-oil rise = 46 × ((1 + 6·1.24²)/7)^1.0 ; gradient = 32 × 1.24^1.3
    const K = 1.24;
    const oil = 46 * ((1 + 6 * K * K) / 7);
    const grad = 32 * Math.pow(K, 1.3);
    const ss = steadyState(healthyOF, K, 7);
    expect(ss.topOil).toBeCloseTo(7 + oil, 9);
    expect(ss.hotSpot).toBeCloseTo(7 + oil + grad, 9);
    // Inside the 120 °C normal cyclic limit at a March ambient of 7 °C.
    expect(ss.hotSpot).toBeCloseTo(116.52, 2);
    expect(ss.hotSpot).toBeLessThan(120);
  });

  it('converges to the steady state and overshoots on the winding first (k21 > 1)', () => {
    let s = { topOil: 20, dh1: 0, dh2: 0 };
    let peakEarly = 0;
    for (let t = 0; t < 72 * 3600; t += 5) {
      const n = iecStep(s, healthyOF, 1.0, true, 20, 5);
      s = n;
      if (t < 30 * 60) peakEarly = Math.max(peakEarly, n.dh1 - n.dh2);
    }
    const ss = steadyState(healthyOF, 1.0, 20);
    expect(s.topOil).toBeCloseTo(ss.topOil, 3);
    expect(s.topOil + s.dh1 - s.dh2).toBeCloseTo(ss.hotSpot, 3);
    expect(peakEarly).toBeGreaterThan(THERMAL.OF.value.hotSpotGradientK); // transient gradient exceeds steady gradient
  });

  it('cools to ambient when de-energised', () => {
    let s = { topOil: 80, dh1: 30, dh2: 5 };
    for (let t = 0; t < 48 * 3600; t += 5) s = iecStep(s, healthyOF, 0, false, 10, 5);
    expect(s.topOil).toBeCloseTo(10, 2);
    expect(s.dh1 - s.dh2).toBeCloseTo(0, 2);
  });

  it('switches fan stages on winding temperature with hysteresis, and forced cooling runs everything', () => {
    expect(nextStage(0, 79, false, true)).toBe(0);
    expect(nextStage(0, 80, false, true)).toBe(1);
    expect(nextStage(1, 90, false, true)).toBe(2);
    expect(nextStage(2, 85, false, true)).toBe(2);
    expect(nextStage(2, 79, false, true)).toBe(1);
    expect(nextStage(1, 69, false, true)).toBe(0);
    expect(nextStage(0, 20, true, true)).toBe(2);
    expect(nextStage(2, 120, true, false)).toBe(0);
  });

  it('reduces capability when the oil pumps fail', () => {
    expect(coolingMode({ coolingType: 'OFAF', pumpFailed: true, stage: 2 }).capacity).toBe(0.5);
    expect(coolingMode({ coolingType: 'OFAF', pumpFailed: true, stage: 2 }, true).capacity).toBe(1);
  });

  it('ages at the normal rate at 98 °C and doubles every 6 K', () => {
    expect(ageingRate(98)).toBeCloseTo(1, 12);
    expect(ageingRate(104)).toBeCloseTo(2, 12);
    expect(ageingRate(110)).toBeCloseTo(4, 12);
  });
});
