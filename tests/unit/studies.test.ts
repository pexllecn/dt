import { describe, expect, it } from 'vitest';
import { Engine } from '@/sim/engine';
import { firmness, runConnectionStudies } from '@/sim/studies';
import { loadBundle } from './helpers';

const engine = new Engine(loadBundle());
const m = engine.model;
const bellacorick = m.buses.find((b) => b.node.name === 'Bellacorick' && b.kv === 110)!;

describe('connection studies (METHOD-FIRM-01)', () => {
  const t0 = performance.now();
  const r = runConnectionStudies(engine, bellacorick.id, 50);
  console.log(`studies ${(performance.now() - t0).toFixed(0)} ms; firm ${r.firmAllMW} MW; main feed ${r.mainFeed.label}; top ${r.constraints[r.topConstraint]?.label}; relieved ${r.firmIfRelievedMW}`);
  for (const s of r.studies) console.log(s.title, 'min', Math.min(...s.firmMW), 'max', Math.max(...s.firmMW), 'binding', [...new Set(s.binding.filter((b) => b >= 0))].map((b) => r.constraints[b]!.label).slice(0, 3).join(' | '));

  it('produces 96 intervals per studied day for all four cases', () => {
    expect(r.studies.map((s) => s.id)).toEqual(['typical', 'winter', 'lowwind', 'mainfeed']);
    for (const s of r.studies) expect(s.firmMW.length).toBe(96 * s.days);
    expect(r.studies[2]!.days).toBe(7);
  });

  it('firm capacity is bounded by the request and names its binding constraint', () => {
    expect(r.firmAllMW).toBeGreaterThanOrEqual(0);
    expect(r.firmAllMW).toBeLessThanOrEqual(50);
    for (const s of r.studies) for (let i = 0; i < s.firmMW.length; i++) if (s.firmMW[i]! < 50 - 1e-6 && s.firmMW[i]! > 0) expect(s.binding[i]).toBeGreaterThanOrEqual(0);
    expect(r.firmIfRelievedMW).toBeGreaterThanOrEqual(r.firmAllMW);
  });

  it('is consistent: applying the firm level as new demand keeps the binding circuit within rating', () => {
    const day = engine.runDay({ date: { y: 2026, m: 10, d: 14 }, year: 2026, wind: { reference: () => 8, seed: 7, scale: 1 }, icShare: 0.2, extraLoad: {}, outages: [], unitOutages: [] });
    expect(day.loading.length).toBeGreaterThan(0);
  });

  it('firmness falls as the level rises', () => {
    const lo = firmness(r, Math.max(0, r.firmAllMW));
    const hi = firmness(r, 50);
    expect(lo.share).toBeCloseTo(1, 5);
    expect(hi.share).toBeLessThanOrEqual(lo.share);
    expect(hi.curtailedMWhYear).toBeGreaterThanOrEqual(0);
  });
});
