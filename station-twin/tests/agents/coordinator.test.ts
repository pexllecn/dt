/** The coordinator and agents in the scenarios: look-ahead, ranking, tracking, the early catch, and audit. */
import { describe, expect, it } from 'vitest';
import { Twin } from '../../src/agents/twin.ts';
import { compareOutcomes, plan, RANK_ORDER } from '../../src/agents/coordinator.ts';
import { Engine } from '../../src/sim/engine.ts';

const fresh = () => { const t = new Twin(); t.wall = () => '2026-03-10T12:00:00.000Z'; return t; };
const pending = (t: Twin) => t.view().recommendations.find((r) => r.status === 'pending');

describe('look-ahead', () => {
  it('is deterministic: the same state gives the same ranked options', () => {
    const e = new Engine();
    e.command({ type: 'scenario', id: 'n1' });
    e.advance(300);
    const a = plan(e.s, 'X', 'test', ['T2'], 'thermal').rec;
    const b = plan(e.s, 'X', 'test', ['T2'], 'thermal').rec;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.options.length).toBeGreaterThan(0);
    for (let i = 1; i < a.options.length; i++) expect(compareOutcomes(a.options[i - 1]!.outcome, a.options[i]!.outcome)).toBeLessThanOrEqual(0);
    expect(RANK_ORDER[0]).toMatch(/Security/);
  });

  it('does not foresee faults: scheduled trips are removed from the copy', () => {
    const t = fresh();
    t.command({ type: 'scenario', id: 'storm' });
    t.advance(900);
    expect(t.s.schedule.some((ev) => ev.kind === 'trip')).toBe(true);
    const r = pending(t)!;
    expect(r).toBeDefined();
    for (const o of r.options) expect(o.outcome.samples.every((x) => x.loadPU.T2 > 0)).toBe(true);
  });
});

describe('tracking', () => {
  it('with no new event, actual matches predicted exactly for the whole horizon', () => {
    const t = fresh();
    t.command({ type: 'scenario', id: 'n1' });
    t.advance(60);
    const r = pending(t)!;
    expect(r.options.length).toBeGreaterThan(0);
    expect(t.decide({ type: 'approve', recId: r.id, optionId: r.options[0]!.id, operator: 'Test operator' }).ok).toBe(true);
    t.advance(r.horizonS + 120);
    const tr = t.view().tracking!;
    expect(tr.holds).toBe(true);
    expect(tr.maxDeviation).toBe(0);
    expect(tr.note).toMatch(/^Complete/);
  });

  it('says the prediction no longer holds when a new event intervenes, and re-plans', () => {
    const t = fresh();
    t.command({ type: 'scenario', id: 'n1' });
    t.advance(60);
    const r = pending(t)!;
    t.decide({ type: 'approve', recId: r.id, optionId: r.options[0]!.id, operator: 'Test operator' });
    t.advance(600);
    t.command({ type: 'scenario', id: 'peak' });
    t.advance(300);
    const tr = t.view().tracking!;
    expect(tr.holds).toBe(false);
    expect(tr.note).toMatch(/no longer holds/);
  });

  it('modify re-runs the look-ahead before the decision', () => {
    const t = fresh();
    t.command({ type: 'scenario', id: 'add_bess' });
    t.command({ type: 'scenario', id: 'n1' });
    t.advance(60);
    const r = pending(t)!;
    const bess = r.options.find((o) => o.id === 'bess-dis');
    expect(bess).toBeDefined();
    expect(t.decide({ type: 'modify', recId: r.id, optionId: 'bess-dis', value: 40, operator: 'Test operator' }).ok).toBe(true);
    const after = pending(t)!.options.find((o) => o.id === 'bess-dis')!;
    expect(after.label).toMatch(/40 MW/);
    expect(after.outcome.peakHotSpot).not.toBe(bess!.outcome.peakHotSpot);
    expect(t.view().audit.at(-1)!.decision).toBe('modify');
  });
});

describe('the early catch', () => {
  it('extended rules detect the pump failure at least 20 simulated minutes before TX-B-02, measured', () => {
    const t = fresh();
    t.command({ type: 'scenario', id: 'cool_fail' });
    t.advance(75 * 60);
    const ec = t.view().earlyCatch!;
    expect(ec.agent).toBe('T1');
    expect(ec.baseProjected).toBe(false);
    expect(ec.gapMin!).toBeGreaterThanOrEqual(20);
    expect(t.agents.firstFire.get('T1:TX-B-02')).toBe(ec.baseT);
  });

  it('in base mode the feed stays silent on T1 until the temperature alarm', () => {
    const t = fresh();
    t.decide({ type: 'ruleset', mode: 'base' });
    const since = t.view().feed.at(-1)?.seq ?? 0;
    t.command({ type: 'scenario', id: 'cool_fail' });
    t.advance(50 * 60);
    expect(t.view().feed.filter((e) => e.seq > since && e.agent === 'T1' && e.outcome === 'fired')).toEqual([]);
    t.advance(20 * 60);
    expect(t.view().feed.some((e) => e.agent === 'T1' && e.ruleId === 'TX-B-02')).toBe(true);
  });
});

describe('agents in the scenarios', () => {
  it('evening peak: the screen flags N-1 insecurity before any fault, with pre-emptive options', () => {
    const t = fresh();
    t.command({ type: 'fastForward', to: 17 * 3600 });
    t.runUntil(17 * 3600);
    t.command({ type: 'scenario', id: 'peak' });
    t.advance(30 * 60);
    expect(t.view().feed.some((e) => e.ruleId === 'METHOD-SCREEN-01' && e.severity === 'warning')).toBe(true);
    expect(t.s.C.T1.tripped || t.s.C.T2.tripped).toBe(false);
    const r = pending(t)!;
    expect(r.options[0]!.outcome.security).toBe('holds');
    expect(r.baseline.security).not.toBe('holds');
  });

  it('N-1 loss of T1: T2 reports its trend before limits, with ranked options', () => {
    const t = fresh();
    t.command({ type: 'scenario', id: 'n1' });
    t.advance(15 * 60);
    const f = t.view().feed;
    expect(f.some((e) => e.agent === 'T2' && e.outcome === 'fired' && e.ruleId.startsWith('TX-E'))).toBe(true);
    expect(t.s.C.T2.temp).toBeLessThan(120);
    expect(pending(t)!.options.length).toBeGreaterThan(1);
  });

  it('storm: the wind agent anticipates cut-out from the forecast', () => {
    const t = fresh();
    t.command({ type: 'scenario', id: 'storm' });
    t.advance(20 * 60);
    const wnd = t.agents.firstFire.get('WIND:WND-01');
    expect(wnd).toBeDefined();
    const cut = t.agents.firstFire.get('WIND:WND-04');
    expect(cut === undefined || cut > wnd!).toBe(true);
  });

  it('system split: the border tie reports loss of coupling and the coordinator offers balancing', () => {
    const t = fresh();
    t.command({ type: 'scenario', id: 'split' });
    t.advance(60);
    expect(t.view().feed.some((e) => e.ruleId === 'TIE-01')).toBe(true);
    const r = pending(t)!;
    expect(r.problem).toBe('balance');
  });

  it('220 kV bus fault: re-energisation is blocked until a person confirms the fault is clear', () => {
    const t = fresh();
    t.command({ type: 'scenario', id: 'busfault' });
    t.advance(60);
    expect(t.view().blocked?.section).toBe('B');
    expect(t.view().feed.some((e) => e.ruleId === 'BUS-03')).toBe(true);
    expect(t.decide({ type: 'confirmClear', section: 'B', operator: 'Test operator' }).ok).toBe(true);
    expect(t.view().blocked).toBeNull();
    expect(t.view().audit.at(-1)!.decision).toBe('confirm');
  });

  it('growth scenarios: advisory headroom before and after', () => {
    const t = fresh();
    t.command({ type: 'scenario', id: 'ie_estate' });
    const a = t.view().feed.find((e) => e.ruleId === 'ADVISORY')!;
    expect(a.text).toMatch(/N-1 headroom .* MW to .* MW/);
  });
});

describe('audit', () => {
  it('records every decision with rule-set hash, input hash and seed, and exports as valid JSON', () => {
    const t = fresh();
    t.command({ type: 'scenario', id: 'n1' });
    t.advance(60);
    const r = pending(t)!;
    t.decide({ type: 'approve', recId: r.id, optionId: r.options[0]!.id, operator: 'Duty engineer' });
    const json = JSON.stringify(t.view().audit);
    const back = JSON.parse(json) as Record<string, unknown>[];
    expect(back.length).toBe(1);
    const e = back[0]!;
    for (const k of ['seq', 'simT', 'wallT', 'operator', 'decision', 'recommendationId', 'option', 'commands', 'ruleSetHash', 'ruleSetMode', 'inputHash', 'seed']) expect(e, k).toHaveProperty(k);
    expect(e.operator).toBe('Duty engineer');
    expect(typeof e.inputHash).toBe('string');
    expect(e.ruleSetHash).toBe(t.view().ruleSetHash);
  });

  it('replays: the input log rebuilds the same state after an approval', () => {
    const t = fresh();
    t.command({ type: 'scenario', id: 'n1' });
    t.advance(60);
    const r = pending(t)!;
    t.decide({ type: 'approve', recId: r.id, optionId: r.options[0]!.id, operator: 'Duty engineer' });
    t.advance(1800);
    const re = Engine.replay('engineering', 1, t.engine.inputLog, t.s.t);
    expect(re.stateHash()).toBe(t.engine.stateHash());
  });
});
