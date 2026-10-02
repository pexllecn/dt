/** The balance closes at every node for any reachable state, and flow directions follow the solve. */
import { describe, expect, it } from 'vitest';
import { createPrng } from '../../src/lib/prng.ts';
import { Engine } from '../../src/sim/engine.ts';
import { computeFlows } from '../../src/sim/balance.ts';
import type { ComponentId } from '../../src/sim/types.ts';

const maxResidual = (e: Engine) => Math.max(...Object.values(e.s.results.residuals).map(Math.abs));

describe('nodal balance (engineering preset)', () => {
  it('closes at every node in 300 random states, every step', () => {
    const rng = createPrng(42);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rng.next() * xs.length)]!;
    const e = new Engine();
    for (const id of ['add_solar', 'add_bess', 'add_gas', 'ie_estate'] as const) e.command({ type: 'scenario', id });
    const switchable: ComponentId[] = ['T1', 'T2', 'T3', 'T4', 'BS220', 'WIND', 'SOLAR', 'GAS', 'BESS', 'LD_NEW', 'LD_IND', 'TIE_N', 'TIE_S', 'TIE_NI'];
    for (let i = 0; i < 300; i++) {
      const r = rng.next();
      if (r < 0.15) e.command({ type: 'operate', id: pick(switchable), device: 'cb', action: rng.next() < 0.5 ? 'open' : 'close' });
      else if (r < 0.3) e.command({ type: 'setBattery', mw: (rng.next() * 2 - 1) * 100 });
      else if (r < 0.45) e.command({ type: 'requestTransfer', id: pick(['TIE_N', 'TIE_S'] as const), mw: (rng.next() * 2 - 1) * 150 });
      else if (r < 0.55) e.command({ type: 'setGeneration', id: 'GAS', out: rng.next() * 180 });
      else if (r < 0.65) e.command({ type: 'setDemand', id: pick(['LD_TOWN', 'LD_NEW', 'LD_IND'] as const), mw: rng.next() * 600, rampMinutes: 10 });
      else if (r < 0.7) e.command({ type: 'scenario', id: 'busfault' });
      else if (r < 0.75) e.command({ type: 'clearBusFault', section: 'B', confirmed: true });
      else if (r < 0.8) e.command({ type: 'couple', coupled: rng.next() < 0.5 });
      expect(maxResidual(e)).toBeLessThan(1e-6);
      e.advance(60);
      expect(maxResidual(e)).toBeLessThan(1e-6);
      const { supply, demand } = e.s.results;
      expect(Math.abs(supply - demand)).toBeLessThan(1 + 1e-6); // parts below 0.5 MW are not listed
    }
  });

  it('reverses the 400 kV flow when local generation exceeds local demand', () => {
    const e = new Engine();
    // Night-time demand: 50 + 0 + 60 MW against 200 MW of wind leaves 90 MW to export.
    e.command({ type: 'setDemand', id: 'LD_TOWN', mw: 50 });
    e.command({ type: 'setDemand', id: 'LD_IND', mw: 0 });
    e.command({ type: 'scenario', id: 'wind_up' });
    e.advance(30 * 60);
    expect(e.s.results.gridFlow).toBeCloseTo(-90, 6);
    expect(e.s.C.GRID.dir).toBe(-1);
    expect(e.s.C.T1.dir).toBe(-1);
    expect(e.s.results.parts.dem.some((p) => p.key === 'grid_export')).toBe(true);
  });

  it('shares equally between T1 and T2 with the bus-section closed, and by section when open', () => {
    const e = new Engine();
    expect(e.s.C.T1.mwNow).toBeCloseTo(e.s.C.T2.mwNow, 9);
    e.command({ type: 'operate', id: 'BS220', device: 'cb', action: 'open' });
    const f = e.s.results.txFlow;
    // Section A: half regional (240) - wind (120) = 120. Section B: half regional (240) + T3 (140) + border (60) = 440.
    expect(f.T1).toBeCloseTo(120, 6);
    expect(f.T2).toBeCloseTo(440, 6);
  });

  it('is pure: computing flows does not change the registry', () => {
    const e = new Engine();
    const before = JSON.stringify(e.s.C);
    computeFlows(e.s.C, e.s.sys, 'engineering', ['T1']);
    expect(JSON.stringify(e.s.C)).toBe(before);
  });
});
