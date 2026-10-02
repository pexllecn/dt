import { describe, expect, it } from 'vitest';
import { blowoutAngle, conductorTemperature, sagAt } from '@/sim/thermal';
import { conductors } from '@/config/network';

describe('conductor thermal and sag model', () => {
  it('reaches the design temperature at full rating in rating conditions', () => {
    for (const kv of [110, 220, 400]) {
      expect(conductorTemperature(kv, 1, 15, 0.6)).toBeCloseTo(conductors[kv]!.maxDesignTempC.value, 6);
    }
  });

  it('runs cooler in a strong wind', () => {
    expect(conductorTemperature(220, 1, 15, 10)).toBeLessThan(conductorTemperature(220, 1, 15, 0.6) - 30);
  });

  it('gives the design sag at the design temperature and less when cool', () => {
    const c = conductors[220]!;
    expect(sagAt(220, c.maxDesignTempC.value)).toBeCloseTo(c.sagAtDesignM.value, 6);
    const cool = sagAt(220, 10);
    expect(cool).toBeLessThan(c.sagAtDesignM.value);
    // A few metres of change between cool and hot on a ~330 m span, as in practice
    expect(c.sagAtDesignM.value - cool).toBeGreaterThan(1);
    expect(c.sagAtDesignM.value - cool).toBeLessThan(5);
  });

  it('increases sag monotonically with temperature', () => {
    let prev = 0;
    for (let t = -10; t <= 100; t += 10) {
      const s = sagAt(110, t);
      expect(s).toBeGreaterThan(prev);
      prev = s;
    }
  });

  it('blows out by tens of degrees in a gale and not at all in calm', () => {
    expect(blowoutAngle(110, 0)).toBe(0);
    const deg = (blowoutAngle(110, 30) * 180) / Math.PI;
    expect(deg).toBeGreaterThan(30);
    expect(deg).toBeLessThan(75);
  });
});
