import { describe, expect, it } from 'vitest';
import { FREQUENCY as F } from '../../src/config/assumptions.ts';
import { AREAS, initialRocof, transient } from '../../src/sim/frequency.ts';
import { Engine } from '../../src/sim/engine.ts';

describe('frequency model', () => {
  it('starts each transient at the analytic rate of change ΔP·f0 / 2Ek', () => {
    const tr = transient(150, AREAS.NI);
    const firstSlope = (tr.series[1]! - tr.series[0]!) / 0.1;
    expect(firstSlope).toBeCloseTo(initialRocof(150, AREAS.NI.ek), 1);
    expect(initialRocof(150, F.kineticEnergyNI.value)).toBeCloseTo(-0.625, 6);
  });
  it('settles at -ΔP / (response + damping) before restoration', () => {
    const tr = transient(150, AREAS.NI);
    const last = tr.series[tr.series.length - 1]!;
    expect(last).toBeCloseTo(50 - 150 / 450, 3);
    expect(tr.nadir).toBeLessThan(last);
  });
  it('does not move when a transformer trips but nothing is lost', () => {
    const e = new Engine();
    e.command({ type: 'scenario', id: 'n1' });
    e.advance(600);
    expect(e.s.frequency.ireland).toBeCloseTo(50, 9);
    expect(e.s.frequency.events).toHaveLength(0);
  });
  it('separates the two areas in a split: Ireland rises, Northern Ireland falls, reserves restore', () => {
    const e = new Engine();
    e.command({ type: 'scenario', id: 'split' });
    e.advance(5);
    const ev = e.s.frequency.events;
    expect(ev.map((x) => x.area).sort()).toEqual(['Ireland', 'Northern Ireland']);
    expect(e.s.frequency.ireland).toBeGreaterThan(50);
    expect(e.s.frequency.ni).toBeLessThan(50);
    e.advance(3600);
    expect(Math.abs(e.s.frequency.ireland - 50)).toBeLessThan(0.001);
    expect(Math.abs(e.s.frequency.ni - 50)).toBeLessThan(0.001);
  });
});
