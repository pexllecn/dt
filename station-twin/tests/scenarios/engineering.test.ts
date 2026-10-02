/** Each claim the demo makes about a scenario, asserted against the engineering preset. */
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/sim/engine.ts';
import { SCENARIOS } from '../../src/sim/scenarios.ts';

const NOON = 12 * 3600;
const at = (e: Engine, minutes: number) => e.runUntil(NOON + minutes * 60);

function peakEngine(): Engine {
  const e = new Engine();
  e.command({ type: 'fastForward', to: 17 * 3600 });
  e.runUntil(17 * 3600);
  e.command({ type: 'scenario', id: 'peak' });
  e.advance(30 * 60);
  return e;
}

describe('baseline', () => {
  it('imports 560 MW, loads each 400/220 kV unit to 62% and is N-1 secure within emergency rating', () => {
    const e = new Engine();
    expect(e.s.results.gridFlow).toBeCloseTo(560, 9);
    expect(e.s.C.T1.loadPU).toBeCloseTo(280 / 450, 9);
    expect(e.s.contingency.worst).toBeCloseTo(560 / 450, 9);
    expect(e.s.contingency.secure).toBe(true);
    expect(e.s.condition).toBe('Normal');
  });
});

describe('every scenario', () => {
  for (const sc of SCENARIOS) {
    it(`${sc.id} runs for four hours with the balance closed`, () => {
      const e = new Engine();
      const r = e.command({ type: 'scenario', id: sc.id });
      expect(r.ok).toBe(true);
      for (let i = 0; i < 48; i++) {
        e.advance(300);
        expect(Math.max(...Object.values(e.s.results.residuals).map(Math.abs))).toBeLessThan(1e-6);
      }
    });
  }
});

describe('evening peak', () => {
  it('flags N-1 insecurity before anything fails', () => {
    const e = peakEngine();
    expect(e.s.results.gridFlow).toBeCloseTo(740, 6);
    expect(e.s.contingency.worst).toBeCloseTo(740 / 450, 6);
    expect(e.s.contingency.secure).toBe(false);
    expect(e.s.condition).toBe('Alert');
    expect(e.s.C.T1.tripped || e.s.C.T2.tripped).toBe(false);
  });
  it('reports the ramp as settling, with the settled import in the deltas', () => {
    const e = new Engine();
    const r = e.command({ type: 'scenario', id: 'peak' });
    expect(r.settling).toBe(true);
    const imp = r.deltas.find((d) => d.key === 'grid')!;
    expect(imp.before).toBeCloseTo(560, 6);
    expect(imp.after).toBeCloseTo(740, 6);
  });
});

describe('N-1 loss of T1', () => {
  it('at baseline: T2 carries 124% and settles inside the 120 °C normal cyclic limit without tripping', () => {
    const e = new Engine();
    e.command({ type: 'scenario', id: 'n1' });
    expect(e.s.C.T2.loadPU).toBeCloseTo(560 / 450, 9);
    at(e, 8 * 60);
    expect(e.s.C.T2.tripped).toBe(false);
    expect(e.s.C.T2.temp).toBeLessThan(120);
    expect(e.s.C.T2.temp).toBeGreaterThan(110);
  });
  it('at the evening peak: T2 alarms within minutes and trips on winding temperature about half an hour later if nothing is done', () => {
    const e = peakEngine();
    const t0 = e.s.t;
    e.command({ type: 'scenario', id: 'n1' });
    let alarm = 0;
    let tripT = 0;
    while (e.s.t < t0 + 2 * 3600 && !tripT) {
      e.step();
      if (!alarm && e.s.C.T2.alarms.wti) alarm = e.s.t - t0;
      if (e.s.C.T2.tripped) tripT = e.s.t - t0;
    }
    expect(alarm / 60).toBeLessThan(10);
    expect(tripT / 60).toBeGreaterThan(20);
    expect(tripT / 60).toBeLessThan(45);
    expect(e.s.C.T2.tripCause).toBe('winding temperature trip');
    expect(e.s.condition).toBe('Supply lost');
  });
  it('at the evening peak with battery and a transfer: T2 survives', () => {
    const e = peakEngine();
    e.command({ type: 'scenario', id: 'add_bess' });
    e.command({ type: 'scenario', id: 'n1' });
    e.command({ type: 'setBattery', mw: 80 });
    e.command({ type: 'scenario', id: 'imp_n' });
    e.advance(4 * 3600);
    expect(e.s.C.T2.tripped).toBe(false);
    expect(e.s.C.T2.temp).toBeLessThan(140);
  });
});

describe('220 kV earth fault on section B', () => {
  it('keeps section A in service, drops half of regional demand, and blocks re-energisation until confirmed', () => {
    const e = new Engine();
    e.command({ type: 'scenario', id: 'busfault' });
    expect(e.s.C.BUS220A.live).toBe(true);
    expect(e.s.C.BUS220B.live).toBe(false);
    expect(e.s.results.regional.offSupply).toBeCloseTo(240, 6);
    expect(e.s.C.LD_IND.live).toBe(false);
    expect(e.s.condition).toBe('Supply lost');
    expect(e.command({ type: 'operate', id: 'T2', device: 'cb', action: 'close' }).ok).toBe(false);
    expect(e.command({ type: 'clearBusFault', section: 'B', confirmed: false }).ok).toBe(false);
    expect(e.command({ type: 'clearBusFault', section: 'B', confirmed: true }).ok).toBe(true);
    e.advance(300);
    expect(e.s.C.BUS220B.live).toBe(true);
    expect(e.s.results.regional.offSupply).toBe(0);
    expect(e.s.results.gridFlow).toBeCloseTo(560, 6);
  });
});

describe('T1 oil pump failure', () => {
  it('runs T1 visibly hotter than T2 long before the base temperature alarm', () => {
    const e = new Engine();
    e.command({ type: 'scenario', id: 'cool_fail' });
    at(e, 15);
    expect(e.s.C.T1.temp - e.s.C.T2.temp).toBeGreaterThan(10);
    expect(e.s.C.T1.alarms.wti).toBe(false);
    let alarm = 0;
    while (!alarm && e.s.t < NOON + 6 * 3600) { e.step(); if (e.s.C.T1.alarms.wti) alarm = e.s.t; }
    expect((alarm - NOON) / 60).toBeGreaterThan(45);
  });
});

describe('storm', () => {
  it('trips T2 by lightning at +40 min, shuts the wind farm down on high wind, and cascades if nothing is done', () => {
    const e = new Engine();
    e.command({ type: 'scenario', id: 'storm' });
    at(e, 39);
    expect(e.s.C.T2.tripped).toBe(false);
    at(e, 41);
    expect(e.s.C.T2.tripped).toBe(true);
    expect(e.s.C.T2.tripCause).toMatch(/lightning/);
    at(e, 120);
    expect(e.s.C.WIND.cutOut).toBe(true);
    expect(e.s.C.WIND.mwNow).toBe(0);
    at(e, 240);
    expect(e.s.C.T1.tripped).toBe(true);
  });
});

describe('system split', () => {
  it('stops the northbound transfer at once and moves the two frequencies apart', () => {
    const e = new Engine();
    e.command({ type: 'scenario', id: 'ni_estate' });
    e.advance(15 * 60);
    expect(e.s.C.TIE_NI.mwNow).toBeCloseTo(150, 6);
    e.command({ type: 'scenario', id: 'split' });
    expect(e.s.C.TIE_NI.mwNow).toBe(0);
    e.advance(5);
    const ni = e.s.frequency.events.find((x) => x.area === 'Northern Ireland')!;
    expect(ni.deltaMw).toBeCloseTo(150, 6);
    expect(ni.rocof).toBeLessThan(-0.5);
    expect(e.s.frequency.ni).toBeLessThan(49.8);
    expect(e.s.frequency.ireland).toBeGreaterThan(50.05);
  });
});

describe('generation mix', () => {
  it('builds solar whose output follows the sun and is zero after sunset', () => {
    const e = new Engine();
    e.command({ type: 'scenario', id: 'add_solar' });
    expect(e.s.C.SOLAR.mwNow).toBeGreaterThan(50);
    e.command({ type: 'scenario', id: 'sun_set' });
    e.runUntil(e.s.fastForwardTo!);
    expect(e.s.C.SOLAR.mwNow).toBe(0);
  });
  it('ramps neighbour transfers in over about 10 minutes', () => {
    const e = new Engine();
    e.command({ type: 'scenario', id: 'imp_n' });
    e.advance(300);
    expect(e.s.C.TIE_N.mwNow).toBeCloseTo(75, 6);
    e.advance(300);
    expect(e.s.C.TIE_N.mwNow).toBeCloseTo(150, 6);
    expect(e.s.results.gridFlow).toBeCloseTo(410, 6);
  });
});
