/**
 * The coordinator: collects agent reports, screens contingencies every five simulated minutes,
 * and on a warning (or an insecure screen) looks ahead on copies of the engine for each candidate
 * action. It ranks them (METHOD-RANK-01), offers them to a person, and tracks the approved one
 * against its prediction. It never acts on its own.
 */
import { LIMITS, PLANT, RATINGS } from '../config/assumptions.ts';
import { computeFlows } from '../sim/balance.ts';
import { Engine, type Command } from '../sim/engine.ts';
import type { ComponentId, SimState, TransformerId } from '../sim/types.ts';
import { AGENT_NAMES, TX_IDS, type AgentSystem, type Forecast } from './agents.ts';
import { narrateRecommendation } from './narration.ts';
import type { AuditEntry, Candidate, EarlyCatch, Option, Outcome, Recommendation, Sample, ScreenResult, SecurityClass, Tracking } from './types.ts';

export const METHODS = {
  screen: 'METHOD-SCREEN-01',
  lookahead: 'METHOD-LOOKAHEAD-01',
  rank: 'METHOD-RANK-01',
  combo: 'METHOD-COMBO-01',
  track: 'METHOD-TRACK-01',
};
export const RANK_ORDER = ['Security over the horizon', 'Customer impact (MW shed × hours)', 'Peak hot-spot margin', 'Local renewable share', 'Fossil energy used'];

const SCREEN_EVERY_S = 300;
const SAMPLE_S = 60;
const REPLAN_COOLDOWN_S = 600;

/** A copy of the engine for look-ahead: the same state and known schedule, but faults are not known in advance. */
export function lookaheadEngine(s: SimState): Engine {
  const e = Engine.fromState(s);
  e.s.schedule = e.s.schedule.filter((ev) => ev.kind !== 'trip');
  return e;
}

export function sampleOf(s: SimState): Sample {
  const rec = <T,>(f: (id: TransformerId) => T) => ({ T1: f('T1'), T2: f('T2'), T3: f('T3'), T4: f('T4') });
  return {
    t: s.t,
    hotSpot: rec((id) => (s.C[id].live ? s.C[id].temp : s.C[id].temp)),
    loadPU: rec((id) => (s.C[id].live ? s.C[id].loadPU : 0)),
    shedMW: s.sys.shedMW, offSupply: s.results.regional.offSupply + (s.C.LD_NEW.installed && s.C.LD_NEW.closed && !s.C.LD_NEW.live ? s.C.LD_NEW.mw : 0),
    gasMW: s.C.GAS.actual, renewPct: s.results.renewPct, gridMW: s.results.gridFlow, freq: s.frequency.ireland, n1Worst: s.contingency.worst,
  };
}

/** Run a copy of the engine with commands applied now, sampling once a minute over the horizon. */
export function simulate(state: SimState, commands: Command[], horizonS: number): Outcome {
  const e = lookaheadEngine(state);
  for (const c of commands) e.command(c);
  const samples: Sample[] = [sampleOf(e.s)];
  for (let t = SAMPLE_S; t <= horizonS + 1e-9; t += SAMPLE_S) { e.advance(SAMPLE_S); samples.push(sampleOf(e.s)); }
  return { ...evaluate(samples), samples, endState: e.snapshot() };
}

export function evaluate(samples: Sample[]): Omit<Outcome, 'samples' | 'endState'> {
  let peakHs = -Infinity, peakLoad = 0, cust = 0, fossil = 0, renew = 0;
  for (const smp of samples) {
    for (const id of TX_IDS) { if (smp.loadPU[id] > 0) peakHs = Math.max(peakHs, smp.hotSpot[id]); peakLoad = Math.max(peakLoad, smp.loadPU[id]); }
    cust += ((smp.shedMW + smp.offSupply) * SAMPLE_S) / 3600;
    fossil += (smp.gasMW * SAMPLE_S) / 3600;
    renew += smp.renewPct;
  }
  if (!Number.isFinite(peakHs)) peakHs = 0;
  // N-1 security once actions have taken effect: the last quarter of the horizon.
  const tail = samples.slice(Math.floor(samples.length * 0.75));
  const n1End = Math.max(...tail.map((x) => x.n1Worst));
  const n1Secure = n1End <= LIMITS.n1SecureLoading.value;
  const security: SecurityClass = peakHs <= LIMITS.hotSpotNormalCyclic.value && peakLoad <= LIMITS.currentNormalCyclic.value && n1Secure ? 'holds'
    : peakHs <= LIMITS.hotSpotLongEmergency.value && peakLoad <= LIMITS.currentShortEmergency.value ? 'tolerable' : 'fails';
  return { security, customerMWh: cust, hotSpotMargin: LIMITS.hotSpotNormalCyclic.value - peakHs, peakHotSpot: peakHs, peakLoadPU: peakLoad, n1End, renewPct: renew / samples.length, fossilMWh: fossil };
}

const SEC_ORDER: Record<SecurityClass, number> = { holds: 0, tolerable: 1, fails: 2 };
/** METHOD-RANK-01: lexicographic, in the printed order. Ties broken by label for determinism. */
export function compareOutcomes(a: Omit<Outcome, 'samples' | 'endState'>, b: Omit<Outcome, 'samples' | 'endState'>): number {
  return SEC_ORDER[a.security] - SEC_ORDER[b.security]
    || round(a.customerMWh, 1) - round(b.customerMWh, 1)
    || round(b.hotSpotMargin, 1) - round(a.hotSpotMargin, 1)
    || round(b.renewPct, 1) - round(a.renewPct, 1)
    || round(a.fossilMWh, 1) - round(b.fossilMWh, 1);
}
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** The action catalogue: every candidate whose preconditions hold now. */
export function catalogue(s: SimState, problem: 'thermal' | 'balance', focus: ComponentId[]): Candidate[] {
  const C = s.C;
  const out: Candidate[] = [];
  // Surplus: export near its limit, or the system has split and the former northbound transfer has nowhere to go.
  const surplus = s.results.gridFlow < -RATINGS.gridExport.value * 0.9 || !s.sys.coupled || s.results.unbal < -1;
  for (const id of TX_IDS) {
    const t = C[id];
    if (t.live && !t.cool && (focus.includes(id) || problem === 'thermal' && (id === 'T1' || id === 'T2'))) {
      out.push({ id: `cool-${id}`, label: `Force all cooling on ${id}`, kind: 'cooling', commands: [{ type: 'forceCooling', id, on: true }], delayS: 0 });
    }
  }
  const b = C.BESS;
  if (b.installed && b.live && !surplus && b.soc > PLANT.batterySocMin.value + 10 && b.set < b.cap - 1) {
    const mw = Math.min(b.cap, 100);
    out.push({ id: 'bess-dis', label: `Discharge the battery at ${mw} MW`, kind: 'battery', commands: [{ type: 'setBattery', mw }], delayS: 0, magnitude: { value: mw, min: 10, max: b.cap, step: 10, unit: 'MW', label: 'Battery discharge' } });
  }
  if (b.installed && b.live && surplus && b.soc < PLANT.batterySocMax.value - 5) {
    out.push({ id: 'bess-chg', label: `Charge the battery at ${b.cap} MW`, kind: 'battery', commands: [{ type: 'setBattery', mw: -b.cap }], delayS: 0, magnitude: { value: b.cap, min: 10, max: b.cap, step: 10, unit: 'MW', label: 'Battery charge' } });
  }
  const g = C.GAS;
  if (!surplus && g.installed && g.live && g.avail > 0 && g.out < 1) {
    out.push({ id: 'gas-start', label: `Start the gas peaker (${g.cap} MW)`, kind: 'gas', commands: [{ type: 'setGeneration', id: 'GAS', out: g.cap }], delayS: (PLANT.gasSyncMin.value + g.cap / PLANT.gasRampMwPerMin.value) * 60, magnitude: { value: g.cap, min: Math.ceil(g.cap * PLANT.gasMinStable.value), max: g.cap, step: 10, unit: 'MW', label: 'Gas output' } });
  }
  if (!surplus && C.TIE_N.live && C.TIE_N.set < 100) {
    out.push({ id: 'tie-n', label: 'Request 150 MW from Ardnagreany', kind: 'transfer', commands: [{ type: 'requestTransfer', id: 'TIE_N', mw: 150 }], delayS: 600, magnitude: { value: 150, min: 10, max: C.TIE_N.cap, step: 10, unit: 'MW', label: 'Transfer in' } });
  }
  if (!surplus && C.TIE_S.live && C.TIE_S.set < 60 && C.T3.live) {
    out.push({ id: 'tie-s', label: 'Request 100 MW from Ballyduff', kind: 'transfer', commands: [{ type: 'requestTransfer', id: 'TIE_S', mw: 100 }], delayS: 600, magnitude: { value: 100, min: 10, max: C.TIE_S.cap, step: 10, unit: 'MW', label: 'Transfer in' } });
  }
  const w = C.WIND;
  if (!surplus && w.installed && w.live && w.avail - w.out > 5) {
    out.push({ id: 'wind-up', label: `Release dispatched-down wind (${Math.round(w.avail - w.out)} MW)`, kind: 'wind', commands: [{ type: 'setGeneration', id: 'WIND', out: Math.round(w.avail) }], delayS: 60 });
  }
  if (surplus && w.installed && w.live && w.actual > 20) {
    const mw = Math.round(Math.min(w.actual, 80));
    out.push({ id: 'wind-down', label: `Dispatch wind down by ${mw} MW`, kind: 'wind', commands: [{ type: 'setGeneration', id: 'WIND', out: Math.max(0, Math.round(w.out - mw)) }], delayS: 60, magnitude: { value: mw, min: 10, max: Math.round(w.actual), step: 10, unit: 'MW', label: 'Dispatch-down' } });
  }
  if (problem === 'thermal' && C.LD_TOWN.live) {
    out.push({ id: 'shed-60', label: 'Shed 60 MW of regional demand', kind: 'shed', commands: [{ type: 'shed', mw: s.sys.shedMW + 60 }], delayS: 0, magnitude: { value: 60, min: 10, max: 240, step: 10, unit: 'MW', label: 'Demand shed' } });
  }
  if (problem === 'balance') out.push({ id: 'rebalance', label: 'Rebalance local dispatch', kind: 'rebalance', commands: [{ type: 'rebalance' }], delayS: 60 });
  return out;
}

/** Rebuild a candidate with a new magnitude (Modify). */
export function withMagnitude(c: Candidate, value: number, s: SimState): Candidate {
  const v = Math.round(value);
  switch (c.id) {
    case 'bess-dis': return { ...c, label: `Discharge the battery at ${v} MW`, commands: [{ type: 'setBattery', mw: v }], magnitude: { ...c.magnitude!, value: v } };
    case 'bess-chg': return { ...c, label: `Charge the battery at ${v} MW`, commands: [{ type: 'setBattery', mw: -v }], magnitude: { ...c.magnitude!, value: v } };
    case 'gas-start': return { ...c, label: `Start the gas peaker (${v} MW)`, commands: [{ type: 'setGeneration', id: 'GAS', out: v }], magnitude: { ...c.magnitude!, value: v } };
    case 'tie-n': return { ...c, label: `Request ${v} MW from Ardnagreany`, commands: [{ type: 'requestTransfer', id: 'TIE_N', mw: v }], magnitude: { ...c.magnitude!, value: v } };
    case 'tie-s': return { ...c, label: `Request ${v} MW from Ballyduff`, commands: [{ type: 'requestTransfer', id: 'TIE_S', mw: v }], magnitude: { ...c.magnitude!, value: v } };
    case 'wind-down': return { ...c, label: `Dispatch wind down by ${v} MW`, commands: [{ type: 'setGeneration', id: 'WIND', out: Math.max(0, Math.round(s.C.WIND.out - v)) }], magnitude: { ...c.magnitude!, value: v } };
    case 'shed-60': return { ...c, label: `Shed ${v} MW of regional demand`, commands: [{ type: 'shed', mw: s.sys.shedMW + v }], magnitude: { ...c.magnitude!, value: v } };
    default: return c;
  }
}

export interface Plan { rec: Recommendation; previews: Record<string, unknown> }

/** Look ahead for every candidate (and pairs of the best if no single one holds), and rank them. */
export function plan(state: SimState, id: string, trigger: string, focus: ComponentId[], problem: 'thermal' | 'balance'): Plan {
  const horizonS = problem === 'thermal' ? 7200 : 1800;
  const strip = (o: Outcome) => { const { endState: _e, ...rest } = o; void _e; return rest; };
  const base = simulate(state, [], horizonS);
  const singles = catalogue(state, problem, focus).map((c) => ({ c, o: simulate(state, c.commands, horizonS) }));
  singles.sort((a, b) => compareOutcomes(a.o, b.o) || a.c.label.localeCompare(b.c.label));
  const methods = [METHODS.lookahead, METHODS.rank];
  let all = singles;
  if (problem === 'thermal' && !singles.some((x) => x.o.security === 'holds') && singles.length >= 2) {
    methods.push(METHODS.combo);
    const best = singles.slice(0, 3);
    const pairs: typeof singles = [];
    for (let i = 0; i < best.length; i++) for (let j = i + 1; j < best.length; j++) {
      const a = best[i]!.c, b = best[j]!.c;
      if (a.kind === b.kind) continue;
      const c: Candidate = { id: `${a.id}+${b.id}`, label: `${a.label}, and ${lowerFirst(b.label)}`, kind: 'combo', commands: [...a.commands, ...b.commands], delayS: Math.max(a.delayS, b.delayS) };
      pairs.push({ c, o: simulate(state, c.commands, horizonS) });
    }
    all = [...singles, ...pairs].sort((a, b) => compareOutcomes(a.o, b.o) || a.c.label.localeCompare(b.c.label));
  }
  // Only options that do at least as well as doing nothing are offered.
  const useful = all.filter((x) => compareOutcomes(x.o, base) < 0).slice(0, 6);
  const options: Option[] = useful.map((x, i) => ({ ...x.c, rank: i + 1, outcome: strip(x.o) }));
  const previews: Record<string, unknown> = { none: base.endState };
  for (const x of useful) previews[x.c.id] = x.o.endState;
  // With nothing better than doing nothing there is no decision to make: the look-ahead is reported, not offered.
  const rec: Recommendation = { id, createdT: state.t, trigger, focus, problem, horizonS, options, baseline: strip(base), status: options.length ? 'pending' : 'completed', chosen: null, methods, advisory: options.length === 0 };
  return { rec, previews };
}

const lowerFirst = (s: string) => s[0]!.toLowerCase() + s.slice(1);

/** METHOD-SCREEN-01: the loss of each 400/220 kV unit, of T3, of each tie, and wind cut-out. */
export function screen(s: SimState): ScreenResult {
  const items: ScreenResult['items'] = [];
  const worstOf = (f: ReturnType<typeof computeFlows>) => {
    let w = 0, a = '';
    for (const id of TX_IDS) if (f.loadPU[id] > w) { w = f.loadPU[id]; a = id; }
    return { w, a };
  };
  const outages: [string, ComponentId[]][] = [['Loss of T1', ['T1']], ['Loss of T2', ['T2']], ['Loss of T3', ['T3']], ['Loss of the Ardnagreany tie', ['TIE_N']], ['Loss of the Ballyduff tie', ['TIE_S']], ['Loss of the border tie', ['TIE_NI']]];
  for (const [name, ids] of outages) {
    if (!ids.every((id) => s.C[id].live)) continue;
    const f = computeFlows(s.C, s.sys, s.preset, ids);
    const { w, a } = worstOf(f);
    const off = f.results.regional.offSupply;
    const secure = w <= LIMITS.n1SecureLoading.value && off < 0.5;
    items.push({ contingency: name, worstLoadPU: w, worstAsset: a, secure, note: off > 0.5 ? `${Math.round(off)} MW off supply` : `${a} at ${Math.round(w * 100)}%` });
  }
  if (s.C.WIND.installed && s.C.WIND.actual > 1) {
    const C = structuredClone(s.C);
    C.WIND.actual = 0; C.WIND.out = 0;
    const f = computeFlows(C, s.sys, s.preset);
    const { w, a } = worstOf(f);
    items.push({ contingency: 'Wind cut-out', worstLoadPU: w, worstAsset: a, secure: w <= LIMITS.n1SecureLoading.value, note: `${a} at ${Math.round(w * 100)}%` });
  }
  return { t: s.t, items, secure: items.every((i) => i.secure) };
}

/** The no-action forecast the agents use for their projected inputs (60 minutes). */
export function forecast(s: SimState): Forecast {
  const e = lookaheadEngine(s);
  const rec = <T,>(v: T): Record<TransformerId, T> => ({ T1: v, T2: v, T3: v, T4: v });
  const maxLoad30 = rec(0), maxHotSpot60 = rec(0), minutesTo120 = rec(999), minutesTo140 = rec(999), loadRise60 = rec(0);
  const load0 = rec(0);
  for (const id of TX_IDS) { load0[id] = s.C[id].loadPU; maxLoad30[id] = s.C[id].loadPU; maxHotSpot60[id] = s.C[id].temp; }
  let maxWind = s.C.WIND.windSpeed;
  for (let m = 1; m <= 60; m++) {
    e.advance(60);
    for (const id of TX_IDS) {
      const c = e.s.C[id];
      if (!c.live) continue;
      if (m <= 30) maxLoad30[id] = Math.max(maxLoad30[id], c.loadPU);
      maxHotSpot60[id] = Math.max(maxHotSpot60[id], c.temp);
      if (c.temp >= LIMITS.hotSpotNormalCyclic.value && minutesTo120[id] === 999) minutesTo120[id] = m;
      if (c.temp >= LIMITS.hotSpotLongEmergency.value && minutesTo140[id] === 999) minutesTo140[id] = m;
      loadRise60[id] = Math.max(loadRise60[id], c.loadPU - load0[id]);
    }
    maxWind = Math.max(maxWind, e.s.C.WIND.windSpeed);
  }
  return { t: s.t, maxLoad30, maxHotSpot60, minutesTo120, minutesTo140, loadRise60, maxWind60: maxWind };
}

/** Minutes until TX-B-02 would fire for a unit, by look-ahead (up to six hours). */
export function projectBaseAlarm(s: SimState, id: TransformerId, threshold: number): number | null {
  const e = lookaheadEngine(s);
  for (let m = 1; m <= 360; m++) {
    e.advance(60);
    if (e.s.C[id].live && e.s.C[id].temp > threshold) return e.s.t;
    if (!e.s.C[id].live) return null;
  }
  return null;
}

export interface CoordinatorState {
  screen: ScreenResult | null;
  recommendations: Recommendation[];
  tracking: Tracking | null;
  audit: AuditEntry[];
  earlyCatch: EarlyCatch | null;
  previews: Record<string, unknown>;
  previewFor: string | null;
}

export class Coordinator {
  state: CoordinatorState = { screen: null, recommendations: [], tracking: null, audit: [], earlyCatch: null, previews: {}, previewFor: null };
  private lastScreen = -1e9;
  private lastPlanT = -1e9;
  private lastKey = '';
  private rejectedKey = '';
  private recSeq = 0;
  /** Recommendations made since reset. */
  get recommendationCount(): number { return this.recSeq; }
  private auditSeq = 0;
  private trackedLogLength = 0;
  private trackingSample = 0;

  reset(): void {
    this.state = { screen: null, recommendations: [], tracking: null, audit: [], earlyCatch: null, previews: {}, previewFor: null };
    this.lastScreen = -1e9; this.lastPlanT = -1e9; this.lastKey = ''; this.rejectedKey = ''; this.trackingSample = 0; this.recSeq = 0;
  }

  tick(engine: Engine, agents: AgentSystem, opts: { fast: boolean }): void {
    const s = engine.s;
    if (s.t - this.lastScreen >= SCREEN_EVERY_S) {
      this.lastScreen = s.t;
      const prevSecure = this.state.screen?.secure ?? true;
      this.state.screen = screen(s);
      agents.forecast = forecast(s);
      if (prevSecure !== this.state.screen.secure) {
        const bad = this.state.screen.items.filter((i) => !i.secure);
        agents.pushTrace({
          t: s.t, agent: 'COORD', ruleId: METHODS.screen, version: '1.0', outcome: 'screen', severity: this.state.screen.secure ? 'info' : 'warning',
          text: this.state.screen.secure ? 'Contingency screen: every contingency is secure.' : `Contingency screen: ${bad.map((b) => `${lowerFirst(b.contingency)} (${b.note})`).join('; ')} would not be secure.`,
          inputs: Object.fromEntries(this.state.screen.items.map((i) => [i.contingency, Math.round(i.worstLoadPU * 100) / 100])), threshold: { value: LIMITS.n1SecureLoading.value, unit: 'per unit', source: LIMITS.n1SecureLoading.source, label: LIMITS.n1SecureLoading.label },
          methods: [METHODS.screen], narration: this.state.screen.secure ? 'The station is N-1 secure again.' : `The station is not N-1 secure: ${bad.map((b) => lowerFirst(b.contingency)).join(' or ')} would overload what remains.`,
        });
      }
    }
    this.updateEarlyCatch(s, agents);
    this.track(engine, agents);
    if (opts.fast && this.state.recommendations.some((r) => r.status === 'pending')) return;
    // Trigger: warnings or worse, or an insecure screen.
    const warn = agents.warnings();
    const insecure = this.state.screen && !this.state.screen.secure;
    // Re-plan when a new agent reports, or an agent's worst severity rises; not for every extra rule.
    const worst = new Map<string, string>();
    for (const w of warn) { const cur = worst.get(w.agent); if (!cur || (cur === 'warning' && w.rule.severity === 'critical')) worst.set(w.agent, w.rule.severity); }
    const keyParts = [...worst].map(([a, sev]) => `${a}:${sev}`).sort();
    if (insecure) keyParts.push('N-1');
    const key = keyParts.join(',');
    if (!key) { this.lastKey = ''; return; }
    if (key === this.lastKey || key === this.rejectedKey) return;
    if (s.t - this.lastPlanT < REPLAN_COOLDOWN_S && this.lastKey && key.split(',').every((k) => this.lastKey.includes(k))) return;
    const pending = this.state.recommendations.find((r) => r.status === 'pending');
    if (pending) pending.status = 'superseded';
    this.lastKey = key;
    this.lastPlanT = s.t;
    const focus = [...new Set(warn.map((w) => w.agent))];
    if (insecure) for (const i of this.state.screen!.items) if (!i.secure && i.worstAsset) focus.push(i.worstAsset as ComponentId);
    const balance = Math.abs(s.results.unbal) > 1 || !s.sys.coupled;
    const busBlocked = warn.some((w) => w.rule.id === 'BUS-02' || w.rule.id === 'BUS-03');
    const lead = warn[0];
    const trigger = lead ? `${AGENT_NAMES[lead.agent]}: ${lead.rule.description}` : `Contingency screen: ${this.state.screen!.items.filter((i) => !i.secure).map((i) => lowerFirst(i.contingency)).join(', ')} would not be secure.`;
    const id = `R${++this.recSeq}`;
    const p = plan(s, id, trigger, [...new Set(focus)], balance ? 'balance' : 'thermal');
    if (busBlocked) p.rec.trigger += ' Re-energisation is blocked until a person confirms the fault is clear.';
    this.state.recommendations.push(p.rec);
    if (this.state.recommendations.length > 8) this.state.recommendations.shift();
    this.state.previews = p.previews;
    this.state.previewFor = p.rec.id;
    agents.pushTrace({
      t: s.t, agent: 'COORD', ruleId: METHODS.lookahead, version: '1.0', outcome: 'lookahead', severity: 'warning',
      text: `Looked ahead ${Math.round(p.rec.horizonS / 60)} minutes for ${p.rec.options.length} options, ranked by ${RANK_ORDER.join(', then ').toLowerCase()}.`,
      inputs: { options: p.rec.options.length, horizonMin: p.rec.horizonS / 60, baselinePeakHotSpot: Math.round(p.rec.baseline.peakHotSpot * 10) / 10, baselineSecurity: p.rec.baseline.security },
      threshold: null, methods: p.rec.methods, narration: narrateRecommendation(p.rec),
    });
  }

  /** Approve an option: re-run its prediction now, act through the engine, and start tracking. */
  approve(engine: Engine, agents: AgentSystem, recId: string, optionId: string, operator: string, wall: string, hashOf: () => string, mode: 'base' | 'extended', ruleSetHash: string): { ok: boolean; reason?: string } {
    const rec = this.state.recommendations.find((r) => r.id === recId);
    const opt = rec?.options.find((o) => o.id === optionId);
    if (!rec || !opt || rec.status !== 'pending') return { ok: false, reason: 'This recommendation is no longer pending.' };
    const s = engine.s;
    const inputHash = hashOf();
    const predicted = simulate(s, opt.commands, rec.horizonS).samples;
    for (const c of opt.commands) engine.command(c);
    rec.status = 'approved';
    rec.chosen = optionId;
    this.trackedLogLength = engine.inputLog.length;
    this.trackingSample = 0;
    this.state.tracking = { recommendationId: rec.id, optionId, startT: s.t, predicted, maxDeviation: 0, holds: true, note: 'On track: actual matches the prediction.' };
    if (opt.kind === 'battery' && opt.magnitude) agents.reserveNeededMWh = (opt.magnitude.value * rec.horizonS) / 3600;
    this.audit({ simT: s.t, wallT: wall, operator, decision: 'approve', recommendationId: rec.id, option: opt.label, commands: opt.commands, ruleSetHash, ruleSetMode: mode, inputHash, seed: s.seed });
    agents.pushTrace({ t: s.t, agent: 'COORD', ruleId: 'DECISION', version: '1.0', outcome: 'decision', severity: 'info', text: `Approved by ${operator}: ${opt.label}.`, inputs: { recommendation: rec.id, rank: opt.rank }, threshold: null, methods: [METHODS.track], narration: `${operator} approved "${lowerFirst(opt.label)}". The coordinator now tracks it against its prediction.` });
    return { ok: true };
  }

  reject(engine: Engine, agents: AgentSystem, recId: string, operator: string, wall: string, hashOf: () => string, mode: 'base' | 'extended', ruleSetHash: string): { ok: boolean; reason?: string } {
    const rec = this.state.recommendations.find((r) => r.id === recId);
    if (!rec || rec.status !== 'pending') return { ok: false, reason: 'This recommendation is no longer pending.' };
    rec.status = 'rejected';
    this.rejectedKey = this.lastKey;
    this.audit({ simT: engine.s.t, wallT: wall, operator, decision: 'reject', recommendationId: rec.id, option: null, commands: [], ruleSetHash, ruleSetMode: mode, inputHash: hashOf(), seed: engine.s.seed });
    agents.pushTrace({ t: engine.s.t, agent: 'COORD', ruleId: 'DECISION', version: '1.0', outcome: 'decision', severity: 'info', text: `Rejected by ${operator}.`, inputs: { recommendation: rec.id }, threshold: null, narration: `${operator} rejected the recommendation. It will not be offered again unless the situation changes.` });
    return { ok: true };
  }

  /** Modify an option's terms and re-run its look-ahead before any decision. */
  modify(engine: Engine, agents: AgentSystem, recId: string, optionId: string, value: number, operator: string, wall: string, hashOf: () => string, mode: 'base' | 'extended', ruleSetHash: string): { ok: boolean; reason?: string } {
    const rec = this.state.recommendations.find((r) => r.id === recId);
    const opt = rec?.options.find((o) => o.id === optionId);
    if (!rec || !opt || rec.status !== 'pending' || !opt.magnitude) return { ok: false, reason: 'This option cannot be modified.' };
    const v = Math.min(opt.magnitude.max, Math.max(opt.magnitude.min, value));
    const c = withMagnitude(opt, v, engine.s);
    const o = simulate(engine.s, c.commands, rec.horizonS);
    const { endState, ...rest } = o;
    const updated: Option = { ...c, rank: opt.rank, outcome: rest };
    rec.options = rec.options.map((x) => (x.id === optionId ? updated : x)).sort((a, b) => compareOutcomes(a.outcome, b.outcome) || a.label.localeCompare(b.label)).map((x, i) => ({ ...x, rank: i + 1 }));
    this.state.previews = { ...this.state.previews, [optionId]: endState };
    this.audit({ simT: engine.s.t, wallT: wall, operator, decision: 'modify', recommendationId: rec.id, option: c.label, commands: c.commands, ruleSetHash, ruleSetMode: mode, inputHash: hashOf(), seed: engine.s.seed });
    agents.pushTrace({ t: engine.s.t, agent: 'COORD', ruleId: METHODS.lookahead, version: '1.0', outcome: 'lookahead', severity: 'info', text: `Modified by ${operator}: ${c.label}. Look-ahead re-run.`, inputs: { value: v, peakHotSpot: Math.round(rest.peakHotSpot * 10) / 10, security: rest.security }, threshold: null, methods: [METHODS.lookahead, METHODS.rank], narration: `With the change, the option ${rest.security === 'holds' ? 'holds every limit' : 'does not hold every limit'}, peaking at ${Math.round(rest.peakHotSpot)} °C.` });
    return { ok: true };
  }

  /** A person confirms the bus fault is clear: the only way to lift the re-energisation block. */
  confirmClear(engine: Engine, agents: AgentSystem, section: 'A' | 'B', operator: string, wall: string, hashOf: () => string, mode: 'base' | 'extended', ruleSetHash: string): { ok: boolean; reason?: string } {
    if (!engine.s.sys.busFault.includes(section)) return { ok: false, reason: 'No fault on that section.' };
    const cmd: Command = { type: 'clearBusFault', section, confirmed: true };
    const r = engine.command(cmd);
    if (!r.ok) return { ok: false, reason: r.reason ?? 'Refused.' };
    this.audit({ simT: engine.s.t, wallT: wall, operator, decision: 'confirm', recommendationId: '-', option: `Fault on section ${section} confirmed clear`, commands: [cmd], ruleSetHash, ruleSetMode: mode, inputHash: hashOf(), seed: engine.s.seed });
    agents.pushTrace({ t: engine.s.t, agent: 'COORD', ruleId: 'DECISION', version: '1.0', outcome: 'decision', severity: 'info', text: `${operator} confirmed the fault on 220 kV section ${section} is clear. Re-energisation unblocked.`, inputs: { section }, threshold: null, narration: `Section ${section} may now be re-energised by its switching programme.` });
    return { ok: true };
  }

  private audit(e: Omit<AuditEntry, 'seq'>): void {
    this.state.audit.push({ ...e, seq: ++this.auditSeq });
  }

  /** METHOD-TRACK-01: compare actual with predicted at each sample time; any new event voids the prediction. */
  private track(engine: Engine, agents: AgentSystem): void {
    const tr = this.state.tracking;
    if (!tr || !tr.holds && tr.note.startsWith('Complete')) return;
    const s = engine.s;
    const k = Math.round((s.t - tr.startT) / SAMPLE_S);
    if (k <= this.trackingSample || Math.abs(s.t - tr.startT - k * SAMPLE_S) > 1e-6) return;
    this.trackingSample = k;
    const newEvent = engine.inputLog.length > this.trackedLogLength || s.log.some((l) => l.t > tr.startT && l.kind === 'protection');
    if (tr.holds && newEvent) {
      tr.holds = false;
      tr.note = 'A new event intervened: the prediction no longer holds. Re-planning.';
      this.lastKey = '';
      agents.pushTrace({ t: s.t, agent: 'COORD', ruleId: METHODS.track, version: '1.0', outcome: 'tracking', severity: 'advisory', text: tr.note, inputs: { minutes: Math.round((s.t - tr.startT) / 60) }, threshold: null, methods: [METHODS.track], narration: 'Something new has happened since the plan was made, so the coordinator is looking again.' });
      return;
    }
    const p = tr.predicted[k];
    if (!p) {
      const rec = this.state.recommendations.find((r) => r.id === tr.recommendationId);
      if (rec) rec.status = 'completed';
      tr.note = tr.holds ? `Complete: actual matched the prediction for the whole horizon (largest deviation ${tr.maxDeviation.toFixed(3)} K).` : 'Complete.';
      agents.reserveNeededMWh = 0;
      return;
    }
    if (!tr.holds) return;
    const a = sampleOf(s);
    let dev = Math.abs(a.gridMW - p.gridMW) / 10;
    for (const id of TX_IDS) dev = Math.max(dev, Math.abs(a.hotSpot[id] - p.hotSpot[id]));
    tr.maxDeviation = Math.max(tr.maxDeviation, dev);
    tr.note = `On track: ${Math.round((s.t - tr.startT) / 60)} of ${Math.round((tr.predicted.length - 1) * SAMPLE_S / 60)} minutes, largest deviation ${tr.maxDeviation.toFixed(3)} K.`;
  }

  /** The early catch: first extended detection against the base temperature alarm, measured or projected. */
  private updateEarlyCatch(s: SimState, agents: AgentSystem): void {
    const ext = ['TX-E-15', 'TX-E-17', 'TX-E-21', 'TX-E-16', 'TX-E-14'];
    for (const id of ['T1', 'T2', 'T3', 'T4'] as const) {
      const firsts = ext.map((r) => ({ r, t: agents.firstFire.get(`${id}:${r}`) })).filter((x) => x.t !== undefined) as { r: string; t: number }[];
      if (!firsts.length || !s.C[id].pumpFailed && !this.state.earlyCatch) continue;
      firsts.sort((a, b) => a.t - b.t);
      const first = firsts[0]!;
      const measured = agents.firstFire.get(`${id}:TX-B-02`);
      const prev = this.state.earlyCatch;
      if (prev && prev.agent !== id) continue;
      let baseT: number | null = measured ?? null;
      let projected = false;
      if (baseT === null) {
        if (prev && prev.baseProjected && prev.baseT !== null) baseT = prev.baseT;
        else { baseT = projectBaseAlarm(s, id, 110); projected = true; }
        projected = true;
      }
      this.state.earlyCatch = { agent: id, extendedT: first.t, extendedRule: first.r, baseT, baseProjected: projected, gapMin: baseT !== null ? (baseT - first.t) / 60 : null };
      return;
    }
  }
}
