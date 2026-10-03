import { describe, expect, it } from 'vitest';
import { Engine } from '@/sim/engine';
import { scenarios } from '@/sim/scenarios';
import { topCorridors } from '@/sim/corridors';
import type { ModelMeta } from '@/sim/protocol';
import { loadBundle } from './helpers';

const engine = new Engine(loadBundle());
const m = engine.model;
const meta = {
  branches: m.branches.map((b) => ({ id: b.id, label: b.label, kv: b.kv, kind: b.kind, from: m.buses[b.from]!.id, to: m.buses[b.to]!.id, circuits: b.circuits, country: m.buses[b.from]!.country, lengthKm: b.lengthKm })),
  buses: m.buses.map((b) => ({ id: b.id, node: b.node.id, kv: b.kv, name: b.node.name, e: b.node.e, n: b.node.n })),
} as unknown as ModelMeta;
const sc = scenarios.y2034;
const inp = (year: number) => ({ date: sc.date, year, wind: { reference: sc.windRef, seed: sc.seed, scale: 1 }, icShare: sc.icShare, extraLoad: {}, outages: [], unitOutages: [] });

describe('2034 corridors (METHOD-CORRIDOR-01)', () => {
  const list = topCorridors(engine.runDay(inp(2034)), meta, 5, engine.runDay(inp(2026)));
  console.log(list.map((c) => `${c.rank}. ${c.label} [${c.branches.length}] +${Math.round(c.score - c.baseScore)} MWh, N-1 ${c.hoursN1} h, peak ${Math.round(c.peakN1 * 100)}%`));
  it('ranks up to five corridors by strain added since 2026', () => {
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < list.length; i++) expect(list[i]!.score - list[i]!.baseScore).toBeLessThanOrEqual(list[i - 1]!.score - list[i - 1]!.baseScore + 1e-6);
    for (const c of list) expect(c.score).toBeGreaterThan(c.baseScore);
  });
  it('merges series circuits through the same station', () => {
    const ids = list.flatMap((c) => c.branches);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
