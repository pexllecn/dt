import { describe, expect, it } from 'vitest';
import { PLANT, SITE } from '../../src/config/assumptions.ts';
import { Engine } from '../../src/sim/engine.ts';
import { batteryEnergyStep } from '../../src/sim/plant/battery.ts';
import { solarFraction, sunPosition } from '../../src/sim/plant/sun.ts';
import { windFraction, windSpeedFor } from '../../src/sim/plant/wind.ts';
import { nextSunset } from '../../src/sim/scenarios.ts';
import { createRegistry } from '../../src/sim/registry.ts';

describe('sun and solar', () => {
  it('puts the March noon sun at about 31° and sunset at about 18:20', () => {
    let max = -90;
    for (let t = 10 * 3600; t < 15 * 3600; t += 60) max = Math.max(max, sunPosition(SITE.epochUtcMs.value, t).elevation);
    expect(max).toBeGreaterThan(30);
    expect(max).toBeLessThan(33);
    const sunset = nextSunset(12 * 3600)!;
    expect(sunset / 3600).toBeGreaterThan(18.15);
    expect(sunset / 3600).toBeLessThan(18.5);
  });
  it('produces nothing at night and more in clear sky than in cloud', () => {
    expect(solarFraction(-5, 0)).toBe(0);
    expect(solarFraction(30, 0)).toBeGreaterThan(solarFraction(30, 1));
    expect(solarFraction(90, 0)).toBe(1);
  });
});

describe('wind farm power curve', () => {
  it('follows cut-in, rated, soft cut-out and restart hysteresis', () => {
    expect(windFraction(2, false).fraction).toBe(0);
    expect(windFraction(12.5, false).fraction).toBeCloseTo(1, 12);
    expect(windFraction(20, false).fraction).toBe(1);
    expect(windFraction(25, false).fraction).toBeCloseTo(0.5, 12);
    const out = windFraction(28, false);
    expect(out.cutOut).toBe(true);
    expect(windFraction(21, true)).toEqual({ fraction: 0, cutOut: true });
    expect(windFraction(19, true).cutOut).toBe(false);
  });
  it('inverts the rising part of the curve', () => {
    for (const f of [0.1, 0.5, 0.8, 0.975]) expect(windFraction(windSpeedFor(f), false).fraction).toBeCloseTo(f, 9);
  });
});

describe('battery', () => {
  it('loses 12% of energy over a full charge and discharge cycle', () => {
    const b = createRegistry('engineering').BESS;
    b.soc = 50;
    const dt = 5;
    // Charge 100 MW for one hour, then discharge until back to 50%.
    for (let t = 0; t < 3600; t += dt) batteryEnergyStep(b, -100, dt);
    const charged = 100 * Math.sqrt(PLANT.batteryRoundTrip.value); // MWh stored
    expect(b.soc).toBeCloseTo(50 + (charged / b.energyCap) * 100, 6);
    let delivered = 0;
    while (b.soc > 50 + 1e-9) { batteryEnergyStep(b, 100, dt); delivered += (100 * dt) / 3600; }
    expect(delivered / 100).toBeCloseTo(PLANT.batteryRoundTrip.value, 2);
  });
  it('stops discharging at the minimum state of charge', () => {
    const e = new Engine();
    e.command({ type: 'scenario', id: 'add_bess' });
    e.command({ type: 'setBattery', mw: 100 });
    e.advance(5 * 3600);
    expect(e.s.C.BESS.soc).toBeGreaterThan(PLANT.batterySocMin.value - 0.1);
    expect(e.s.C.BESS.mwNow).toBe(0);
  });
});

describe('gas peaker', () => {
  it('synchronises after 5 minutes and reaches 180 MW 15 minutes after the start command', () => {
    const e = new Engine();
    e.command({ type: 'scenario', id: 'add_gas' });
    e.command({ type: 'setGeneration', id: 'GAS', out: 180 });
    e.advance(4.9 * 60);
    expect(e.s.C.GAS.mwNow).toBe(0);
    e.advance(5.2 * 60);
    expect(e.s.C.GAS.gasState).toBe('running');
    expect(e.s.C.GAS.mwNow).toBeGreaterThan(0);
    expect(e.s.C.GAS.mwNow).toBeLessThan(180);
    e.advance(5 * 60);
    expect(e.s.C.GAS.mwNow).toBeCloseTo(180, 6);
  });
  it('trips with its busbar (no islanded running)', () => {
    const e = new Engine();
    e.command({ type: 'scenario', id: 'add_gas' });
    e.command({ type: 'setGeneration', id: 'GAS', out: 180 });
    e.advance(20 * 60);
    e.command({ type: 'operate', id: 'T1', device: 'cb', action: 'open' });
    e.command({ type: 'operate', id: 'BS220', device: 'cb', action: 'open' });
    e.advance(10);
    expect(e.s.C.BUS220A.live).toBe(false);
    expect(e.s.C.GAS.mwNow).toBe(0);
    expect(e.s.C.GAS.gasState).toBe('off');
  });
});
