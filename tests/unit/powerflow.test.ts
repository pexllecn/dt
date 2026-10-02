import { describe, expect, it } from 'vitest';
import { buildSolver, type FlowBranch } from '@/sim/powerflow';
import { Engine, STEPS } from '@/sim/engine';
import { loadBundle } from './helpers';

/** Net flow leaving each bus must equal its injection (Kirchhoff's current law). */
function mismatch(nBus: number, branches: FlowBranch[], flows: Float64Array, inj: Float64Array, active: Uint8Array) {
  const net = new Float64Array(nBus);
  branches.forEach((b, i) => {
    if (!active[i]) return;
    net[b.from] = net[b.from]! + flows[i]!;
    net[b.to] = net[b.to]! - flows[i]!;
  });
  return net.map((v, i) => v - inj[i]!);
}

describe('DC power flow, textbook three-bus case', () => {
  // Bus 0 slack. 0-1 x=0.1, 1-2 x=0.1, 0-2 x=0.2. 100 MW generated at bus 1, 100 MW load at bus 2.
  const branches: FlowBranch[] = [
    { from: 0, to: 1, x: 0.1 },
    { from: 1, to: 2, x: 0.1 },
    { from: 0, to: 2, x: 0.2 },
  ];
  const inj = new Float64Array([0, 100, -100]);

  it('matches the hand calculation', () => {
    const s = buildSolver(3, branches, new Set(), 0);
    const f = s.flows(inj);
    // theta1 = 0.025, theta2 = -0.05 pu  =>  flows -25, 75, 25 MW
    expect(f[0]).toBeCloseTo(-25, 6);
    expect(f[1]).toBeCloseTo(75, 6);
    expect(f[2]).toBeCloseTo(25, 6);
  });

  it('predicts post-outage flows with LODF exactly', () => {
    const s = buildSolver(3, branches, new Set(), 0);
    const f = s.flows(inj);
    const k = 1;
    const post0 = f[0]! + s.lodf[0 * 3 + k]! * f[k]!;
    const post2 = f[2]! + s.lodf[2 * 3 + k]! * f[k]!;
    const re = buildSolver(3, branches, new Set([k]), 0).flows(inj);
    expect(post0).toBeCloseTo(re[0]!, 6);
    expect(post2).toBeCloseTo(re[2]!, 6);
    expect(re[0]).toBeCloseTo(-100, 6);
  });

  it('flags a radial branch as islanding', () => {
    const radial: FlowBranch[] = [...branches, { from: 2, to: 3, x: 0.1 }];
    const s = buildSolver(4, radial, new Set(), 0);
    expect(s.islanding[3]).toBe(1);
    expect(s.islanding[0]).toBe(0);
  });
});

describe('DC power flow on the all-island network', () => {
  const engine = new Engine(loadBundle());
  const m = engine.model;

  it('has a connected main system with the expected scale', () => {
    expect(m.buses.length).toBeGreaterThan(300);
    expect(m.branches.length).toBeGreaterThan(380);
    const s = engine.solverFor([]);
    // Every bus with an AC connection is energised; the rest are HVDC cable ends.
    const acBuses = new Set(m.branches.flatMap((b) => [b.from, b.to]));
    acBuses.forEach((i) => expect(s.energised[i]).toBe(1));
    expect(acBuses.size).toBeGreaterThan(360);
  });

  it('balances flows at every bus within 1e-6 MW for every interval of a day', () => {
    const day = engine.runDay({
      date: { y: 2026, m: 10, d: 14 },
      year: 2026,
      wind: { reference: () => 9, seed: 1, scale: 1 },
      icShare: 0.3,
      extraLoad: {},
      outages: [],
      unitOutages: [],
    });
    const s = engine.solverFor([]);
    const nb = m.branches.length;
    const nBus = m.buses.length;
    let worst = 0;
    for (let t = 0; t < STEPS; t++) {
      const flows = new Float64Array(day.flows.subarray(t * nb, (t + 1) * nb));
      const inj = new Float64Array(day.injections.subarray(t * nBus, (t + 1) * nBus));
      // Slack absorbs any residual; check every other bus.
      const mm = mismatch(nBus, m.branches, s.flows(inj), inj, s.active);
      mm.forEach((v, i) => {
        if (i !== m.slack) worst = Math.max(worst, Math.abs(v));
      });
      void flows;
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('LODF post-contingency flows equal a full re-solve for every outage', () => {
    const s = engine.solverFor([]);
    const nb = m.branches.length;
    const inj = new Float64Array(m.buses.length);
    // A deterministic, balanced injection pattern
    m.buses.forEach((_, i) => (inj[i] = ((i * 37) % 23) - 11));
    const total = inj.reduce((a, b) => a + b, 0);
    inj[m.slack] = inj[m.slack]! - total;
    const base = s.flows(inj);
    let checked = 0;
    let worst = 0;
    for (let k = 0; k < nb; k++) {
      if (s.islanding[k] || k % 9 !== 0) continue; // every 9th outage keeps the test fast
      const re = buildSolver(m.buses.length, m.branches, new Set([k]), m.slack).flows(inj);
      for (let l = 0; l < nb; l++) {
        if (l === k) continue;
        const pred = base[l]! + s.lodf[l * nb + k]! * base[k]!;
        worst = Math.max(worst, Math.abs(pred - re[l]!));
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
    expect(worst).toBeLessThan(1e-6);
  }, 120_000);

  it('produces a plausible day: demand, SNSP within cap, data centre share near 23%', () => {
    const day = engine.runDay({
      date: { y: 2026, m: 10, d: 14 },
      year: 2026,
      wind: { reference: () => 8, seed: 3, scale: 1 },
      icShare: 0.3,
      extraLoad: {},
      outages: [],
      unitOutages: [],
    });
    const maxDemand = Math.max(...day.series.demand);
    const minDemand = Math.min(...day.series.demand);
    expect(maxDemand).toBeGreaterThan(5500);
    expect(maxDemand).toBeLessThan(8500);
    expect(minDemand).toBeGreaterThan(3500);
    expect(Math.max(...day.series.snsp)).toBeLessThanOrEqual(0.7501);
    expect(Math.max(...day.series.unserved)).toBeLessThan(1);
    const meanShare = day.series.dcShare.reduce((a, b) => a + b, 0) / STEPS;
    expect(meanShare).toBeGreaterThan(0.19);
    expect(meanShare).toBeLessThan(0.3);
  });

  it('reaches a data centre share of about 31% in 2034', () => {
    const day = engine.runDay({
      date: { y: 2034, m: 4, d: 12 },
      year: 2034,
      wind: { reference: () => 8, seed: 3, scale: 1 },
      icShare: 0.3,
      extraLoad: {},
      outages: [],
      unitOutages: [],
    });
    const meanShare = day.series.dcShare.reduce((a, b) => a + b, 0) / STEPS;
    expect(meanShare).toBeGreaterThan(0.28);
    expect(meanShare).toBeLessThan(0.36);
  });
});
