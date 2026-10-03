/** The fold: timing, interruptibility, coverage of the diagram, and live device state. */
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/sim/engine.ts';
import { FOLD_SECONDS, FoldController, FoldLayer, STAGES, travelWindow } from '../../src/scene/fold.ts';
import { FEEDERS, RAILS, schematicAnchors } from '../../src/scene/schematic.ts';
import { BAYS } from '../../src/scene/layout.ts';
import { createMaterials } from '../../src/scene/materials.ts';
import { buildStation } from '../../src/scene/station.ts';

const station = buildStation(createMaterials());

describe('fold controller', () => {
  it('completes in under 2.5 s in each direction', () => {
    expect(FOLD_SECONDS).toBeLessThan(2.5);
    for (const target of [1, 0] as const) {
      const c = new FoldController();
      c.progress = 1 - target;
      c.target = target;
      let t = 0;
      while (c.moving) { c.step(1 / 60); t += 1 / 60; }
      expect(t).toBeLessThan(2.5);
      expect(c.p).toBe(target);
    }
  });

  it('reverses from wherever it is, without a jump', () => {
    const c = new FoldController();
    c.target = 1;
    for (let i = 0; i < 40; i++) c.step(1 / 60);
    const mid = c.p;
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
    c.target = 0;
    c.step(1 / 60);
    expect(Math.abs(c.p - mid)).toBeLessThan(1 / 60 / FOLD_SECONDS + 1e-12);
    expect(c.p).toBeLessThan(mid);
    let t = 0;
    while (c.moving) { c.step(1 / 60); t += 1 / 60; }
    expect(c.p).toBe(0);
    expect(t).toBeLessThan(mid * FOLD_SECONDS + 0.05);
  });

  it('orders the stages: dissolve, travel, resolve, label, all within the fold', () => {
    expect(STAGES.dissolve[0]).toBe(0);
    expect(STAGES.travel[0]).toBeLessThan(STAGES.resolve[0]);
    expect(STAGES.resolve[0]).toBeLessThan(STAGES.label[0]);
    for (const s of [0, 0.5, 1]) { const [a, b] = travelWindow(s); expect(a).toBeGreaterThanOrEqual(STAGES.travel[0]); expect(b).toBeLessThanOrEqual(STAGES.travel[1] + 1e-9); }
  });
});

describe('the diagram covers the station', () => {
  it('has a feeder for every bay, and a rail for every busbar', () => {
    const keys = new Set(FEEDERS.map((f) => f.key));
    for (const b of BAYS) expect(keys.has(b.key), b.key).toBe(true);
    expect(keys.has('BS220')).toBe(true);
    expect(RAILS.map((r) => r.id).sort()).toEqual(['BUS110', 'BUS220A', 'BUS220B', 'BUS400']);
    for (const p of station.paths) expect(keys.has(p.key), p.key).toBe(true);
  });

  it('gives every labelled component a place in the diagram', () => {
    const a = schematicAnchors();
    for (const id of ['T1', 'T2', 'GRID', 'LD_TOWN', 'WIND', 'T3', 'T4', 'TIE_NI', 'TIE_N', 'SOLAR', 'GAS', 'BESS', 'LD_NEW', 'LD_IND', 'TIE_S', 'BS220', 'BUS400', 'BUS220A', 'BUS220B', 'BUS110'] as const) {
      expect(a.has(id), id).toBe(true);
    }
  });

  it('keeps feeders apart so labels and symbols do not collide', () => {
    for (const r of RAILS) {
      const xs = FEEDERS.filter((f) => f.pts[0]![1] === r.z && f.pts[0]![0] >= r.x0 && f.pts[0]![0] <= r.x1 && f.key !== 'BS220')
        .map((f) => ({ x: f.pts[0]![0], side: Math.sign(f.pts[1]![1] - f.pts[0]![1]) }));
      for (const side of [-1, 1]) {
        const s = xs.filter((x) => x.side === side).map((x) => x.x).sort((p, q) => p - q);
        for (let i = 1; i < s.length; i++) expect(s[i]! - s[i - 1]!).toBeGreaterThanOrEqual(30);
      }
    }
  });
});

describe('symbols follow the switching state', () => {
  it('shows each breaker and disconnector as the engine has it', () => {
    const fold = new FoldLayer(station.paths);
    const e = new Engine();
    e.command({ type: 'scenario', id: 'n1' });
    e.advance(60);
    const states = fold.deviceStates(e.s);
    const t1cb = states.find((d) => d.owner === 'T1' && d.device === 'cb')!;
    expect(t1cb.closed).toBe(e.s.C.T1.closed);
    expect(t1cb.closed).toBe(false);
    expect(states.filter((d) => d.owner === 'T2' && d.device === 'cb').every((d) => d.closed)).toBe(true);
    expect(states.length).toBeGreaterThan(50);
  });
});
