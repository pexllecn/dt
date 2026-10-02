import { describe, expect, it } from 'vitest';
import { Engine, type EngineInputs } from '@/sim/engine';
import { AgentEngine, type AgentOptions } from '@/agents/engine';
import { scenarios } from '@/sim/scenarios';
import { loadBundle } from './helpers';

const engine = new Engine(loadBundle());
const agents = new AgentEngine(engine);
const sc = scenarios.storm;
const base: EngineInputs = {
  date: sc.date,
  year: 2026,
  wind: { reference: sc.windRef, front: sc.front, seed: sc.seed, scale: 1 },
  icShare: sc.icShare,
  extraLoad: {},
  outages: [],
  unitOutages: [],
};
const opts: AgentOptions = { scenarioWind: base.wind, ambientC: 7, humidityPct: 95, commsLostFromStep: null, stalePolicy: 'consistency', tripSteps: {} };
const run = (inp: EngineInputs, o: AgentOptions = opts) => {
  const day = engine.runDay(inp);
  return { day, ag: agents.run(day, o, inp.icShare, (s) => engine.outagesAt(inp, s), { year: inp.year }) };
};

describe('agent engine', () => {
  it('is deterministic: the same inputs give the same trace', () => {
    const a = run(base).ag.trace.map((t) => `${t.step}|${t.agentId}|${t.ruleId}|${t.event}`).join('\n');
    const b = run(base).ag.trace.map((t) => `${t.step}|${t.agentId}|${t.ruleId}|${t.event}`).join('\n');
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('records rule, inputs, threshold and outcome on every trace entry', () => {
    const t0 = performance.now();
    const { ag } = run(base);
    console.log(`agents: ${agents.agents.length}, trace entries: ${ag.trace.length}, day + agents ${(performance.now() - t0).toFixed(0)} ms`);
    for (const t of ag.trace.slice(0, 200)) {
      expect(t.ruleId).toMatch(/^[A-Z]+-/);
      expect(t.ruleText.length).toBeGreaterThan(5);
      expect(Object.keys(t.inputs).length).toBeGreaterThan(0);
      expect(typeof t.threshold.value).toBe('number');
      expect(t.outcome.length).toBeGreaterThan(5);
    }
  });

  it('catches the planted transformer gas trend only with the extended rule set', () => {
    const { ag } = run(base);
    const srananagh = ag.trace.filter((t) => t.agentType === 'transformer' && /Srananagh/.test(t.agentName) && t.event === 'fired');
    expect(srananagh.some((t) => t.maturity === 'extended' && /^TX-E-0(08|10|11)$/.test(t.ruleId))).toBe(true);
    expect(srananagh.some((t) => t.maturity === 'base' && t.ruleId === 'TX-B-004')).toBe(false);
  });

  it('marks Region W stale after comms loss and reduces coordinator confidence', () => {
    const { ag } = run(base, { ...opts, commsLostFromStep: 48 });
    const stale = ag.trace.filter((t) => t.stale && t.step >= 48);
    expect(stale.length).toBeGreaterThan(0);
    const county = new Map(agents.agents.map((a) => [a.id, a.county]));
    const regionW = new Set(['Mayo', 'Galway', 'Sligo', 'Roscommon', 'Leitrim']);
    expect(stale.every((t) => regionW.has(county.get(t.agentId) ?? ''))).toBe(true);
    expect(ag.confidence[60]!).toBeLessThan(ag.confidence[10]!);
  });

  it('proposes re-dispatch when a trip overloads a circuit, and the proposal relieves it', () => {
    const m = engine.model;
    // Trip the most heavily loaded 220 kV circuit at 18:00 and look for a resulting N overload.
    const peek = engine.runDay(base);
    const nb = m.branches.length;
    const s = 72;
    const cand = m.branches
      .filter((b) => b.kv === 220 && b.kind === 'line')
      .sort((a, b) => peek.loading[s * nb + b.idx]! - peek.loading[s * nb + a.idx]!)
      .slice(0, 12);
    let found = false;
    for (const b of cand) {
      const inp = { ...base, timedOutages: [{ branch: b.idx, fromStep: s }] };
      const { ag } = run(inp);
      const rec = ag.recommendations.find((r) => r.step >= s);
      if (!rec) continue;
      found = true;
      expect(rec.actions.length).toBeGreaterThanOrEqual(2);
      const net = rec.actions.reduce((a, x) => a + x.deltaMW, 0);
      expect(Math.abs(net)).toBeLessThanOrEqual(1);
      expect(rec.afterLoading).toBeLessThan(rec.beforeLoading);
      // Apply the proposal and check the target circuit is relieved by the engine itself.
      const adj = rec.actions.map((a) => ({ bus: m.busIndex.get(a.bus)!, deltaMW: a.deltaMW, fromStep: rec.step }));
      const after = engine.runDay({ ...inp, adjustments: adj });
      const ti = m.branches.findIndex((x) => x.id === rec.targetBranch);
      expect(after.loading[rec.step * nb + ti]!).toBeLessThan(peek.loading[rec.step * nb + ti]! + 10);
      expect(after.loading[rec.step * nb + ti]!).toBeLessThan(rec.beforeLoading);
      break;
    }
    expect(found).toBe(true);
  }, 120_000);
});

describe('storm script: trip with comms loss', () => {
  const L35 = engine.model.branches.findIndex((b) => b.label === 'Flagford to Srananagh 220 kV');
  const inp: EngineInputs = { ...base, timedOutages: [{ branch: L35, fromStep: 48 }] };
  const withPolicy = (stalePolicy: AgentOptions['stalePolicy']) =>
    run(inp, { ...opts, commsLostFromStep: 47, stalePolicy, tripSteps: { [engine.model.branches[L35]!.id]: 48 } }).ag.recommendations.find((r) => r.step === 48);

  it('proposes relief at the trip; consistency withholds stale assets, availability uses them flagged', () => {
    expect(L35).toBeGreaterThanOrEqual(0);
    const c = withPolicy('consistency');
    const a = withPolicy('availability');
    expect(c).toBeDefined();
    expect(a).toBeDefined();
    expect(c!.withheld.length).toBeGreaterThan(0);
    expect(c!.actions.every((x) => !x.stale)).toBe(true);
    expect(a!.actions.some((x) => x.stale)).toBe(true);
    expect(a!.confidence).toBeLessThan(1);
    // Using the stale assets relieves more; withholding them leaves the circuit partly loaded.
    expect(a!.afterLoading).toBeLessThan(c!.afterLoading);
    expect(a!.afterLoading).toBeLessThan(1);
  });
});
