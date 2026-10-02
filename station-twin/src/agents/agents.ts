/**
 * The asset agents. Each holds its own state and memory (history, its own thermal model of a
 * healthy unit), evaluates its frozen rules every step, publishes a summary to its electrical
 * neighbours, and emits trace entries on transitions only.
 */
import { BASELINE, LIMITS, PLANT, RATINGS, THERMAL } from '../config/assumptions.ts';
import { hash } from '../lib/hash.ts';
import { ambientAt, ageingRate, coolingMode, iecStep } from '../sim/thermal/iec60076.ts';
import type { ComponentId, SimState, TransformerId } from '../sim/types.ts';
import {
  BATTERY_RULES, BUS_RATING_MW, BUS_RULES, DEMAND_RULES, GAS_RULES, INFEED_RULES, TIE_RULES, WIND_RULES,
  type BatteryInput, type BusInput, type DemandInput, type GasInput, type InfeedInput, type TieInput, type WindInput,
} from './rules/assets.ts';
import { TX_BASE, TX_EXTENDED, type TxInput } from './rules/transformer.ts';
import { narrateRule } from './narration.ts';
import type { AgentStatus, AnyRule, Arc, RuleSetMode, Severity, TraceEntry } from './types.ts';

export const TX_IDS: readonly TransformerId[] = ['T1', 'T2', 'T3', 'T4'];
export const AGENT_NAMES: Record<ComponentId, string> = {
  T1: 'T1', T2: 'T2', T3: 'T3', T4: 'T4', BUS400: '400 kV busbar', BUS220A: '220 kV section A', BUS220B: '220 kV section B', BUS110: '110 kV busbar',
  WIND: 'Wind', SOLAR: 'Solar', BESS: 'Battery', GAS: 'Gas', LD_TOWN: 'Regional demand', LD_NEW: 'New demand connection', LD_IND: 'Industrial park',
  TIE_N: 'Ardnagreany tie', TIE_S: 'Ballyduff tie', TIE_NI: 'Border tie', GRID: '400 kV infeed', BS220: 'Bus section',
};

/** Every rule, for the rule-set hash and the generated tests. */
export const ALL_RULES = { TX_BASE, TX_EXTENDED, BUS_RULES, WIND_RULES, BATTERY_RULES, GAS_RULES, DEMAND_RULES, TIE_RULES, INFEED_RULES };

export function ruleSetHash(mode: RuleSetMode): string {
  const rules = [...TX_BASE, ...(mode === 'extended' ? TX_EXTENDED : []), ...BUS_RULES, ...WIND_RULES, ...BATTERY_RULES, ...GAS_RULES, ...DEMAND_RULES, ...TIE_RULES, ...INFEED_RULES];
  return hash(rules.map((r) => [r.id, r.version, r.threshold.value, r.threshold.unit, r.severity, r.action, r.description]));
}
export function ruleCount(mode: RuleSetMode): number {
  return TX_BASE.length + (mode === 'extended' ? TX_EXTENDED.length : 0) + BUS_RULES.length + WIND_RULES.length + BATTERY_RULES.length + GAS_RULES.length + DEMAND_RULES.length + TIE_RULES.length + INFEED_RULES.length;
}

/** Forecast published by the coordinator's no-action look-ahead (60 minutes). */
export interface Forecast {
  t: number;
  maxLoad30: Record<TransformerId, number>;
  maxHotSpot60: Record<TransformerId, number>;
  minutesTo120: Record<TransformerId, number>;
  minutesTo140: Record<TransformerId, number>;
  loadRise60: Record<TransformerId, number>;
  maxWind60: number;
}

interface TxMemory {
  hist: { t: number; load: number; hs: number; to: number; res: number }[];
  model: { topOil: number; dh1: number; dh2: number } | null;
  minutesAbove100: number;
  excessAgeingH: number;
  forcedSince: number | null;
  shortfallMin: number;
  n1Cache: { t: number; minutes: number };
}

const SEV: Record<Severity, number> = { info: 0, advisory: 1, warning: 2, critical: 3 };

interface AgentDef { id: ComponentId; rules: () => readonly AnyRule[]; input: (s: SimState) => object }

export class AgentSystem {
  mode: RuleSetMode = 'extended';
  readonly feed: TraceEntry[] = [];
  readonly statuses = new Map<ComponentId, AgentStatus>();
  readonly arcs: Arc[] = [];
  /** First fire time of every rule on every agent (evaluated in both modes, reported in one). */
  readonly firstFire = new Map<string, number>();
  /** Last published summary of each agent, with its time. */
  readonly published = new Map<ComponentId, { key: string; t: number }>();
  /** Latest input of every agent (for the inspector and the coordinator). */
  readonly inputs = new Map<ComponentId, object>();
  forecast: Forecast | null = null;
  reserveNeededMWh = 0;
  private active = new Map<ComponentId, Set<string>>();
  private tx = new Map<TransformerId, TxMemory>();
  private seq = 0;
  private lastT = -1;
  private defs: AgentDef[];

  constructor() {
    const d: AgentDef[] = [];
    for (const id of TX_IDS) d.push({ id, rules: () => [...TX_BASE, ...TX_EXTENDED], input: (s) => this.txInput(s, id) });
    for (const id of ['BUS400', 'BUS220A', 'BUS220B', 'BUS110'] as const) d.push({ id, rules: () => BUS_RULES, input: (s) => this.busInput(s, id) });
    d.push({ id: 'WIND', rules: () => WIND_RULES, input: (s) => this.windInput(s) });
    d.push({ id: 'BESS', rules: () => BATTERY_RULES, input: (s) => this.batteryInput(s) });
    d.push({ id: 'GAS', rules: () => GAS_RULES, input: (s) => this.gasInput(s) });
    for (const id of ['LD_TOWN', 'LD_NEW', 'LD_IND'] as const) d.push({ id, rules: () => DEMAND_RULES, input: (s) => this.demandInput(s, id) });
    for (const id of ['TIE_N', 'TIE_S', 'TIE_NI'] as const) d.push({ id, rules: () => TIE_RULES, input: (s) => this.tieInput(s, id) });
    d.push({ id: 'GRID', rules: () => INFEED_RULES, input: (s) => this.infeedInput(s) });
    this.defs = d;
    for (const a of d) { this.active.set(a.id, new Set()); this.statuses.set(a.id, { id: a.id, level: 'calm', active: [], changedT: 0 }); }
  }

  reset(): void {
    this.feed.length = 0;
    this.arcs.length = 0;
    this.firstFire.clear();
    this.published.clear();
    this.tx.clear();
    this.forecast = null;
    this.lastT = -1;
    for (const [id, set] of this.active) { set.clear(); this.statuses.set(id, { id, level: 'calm', active: [], changedT: 0 }); }
  }

  /** Is this rule reported in the current mode? Extended transformer rules are evaluated silently in base mode. */
  reported(rule: AnyRule): boolean {
    return this.mode === 'extended' || rule.maturity === 'base';
  }

  observe(s: SimState, dt: number): void {
    if (s.t < this.lastT) this.reset();
    this.lastT = s.t;
    this.updateMemory(s, dt);
    const changedPublishers: ComponentId[] = [];
    const changedEvaluations: ComponentId[] = [];
    for (const def of this.defs) {
      const input = def.input(s);
      this.inputs.set(def.id, input);
      const set = this.active.get(def.id)!;
      let changed = false;
      for (const rule of def.rules() as readonly AnyRule[]) {
        const fires = rule.condition(input, rule.threshold.value);
        const key = `${def.id}:${rule.id}`;
        if (fires && !this.firstFire.has(key)) this.firstFire.set(key, s.t);
        const was = set.has(rule.id);
        if (fires === was) continue;
        if (fires) set.add(rule.id); else set.delete(rule.id);
        if (!this.reported(rule)) continue;
        changed = true;
        this.emit(s.t, def.id, rule, input, fires ? 'fired' : 'cleared');
      }
      const reportedActive = [...set].filter((id) => { const r = (def.rules() as readonly AnyRule[]).find((x) => x.id === id)!; return this.reported(r); });
      const level = reportedActive.reduce<AgentStatus['level']>((lv, id) => {
        const sev = (def.rules() as readonly AnyRule[]).find((x) => x.id === id)!.severity;
        if (sev === 'info') return lv;
        return lv === 'calm' || SEV[sev] > SEV[lv as Severity] ? sev : lv;
      }, 'calm');
      if (changed) {
        this.statuses.set(def.id, { id: def.id, level, active: reportedActive, changedT: s.t });
        changedEvaluations.push(def.id);
      }
      const pub = this.publishKey(def.id, s, level);
      const prev = this.published.get(def.id);
      if (!prev || prev.key !== pub) { this.published.set(def.id, { key: pub, t: s.t }); if (prev) changedPublishers.push(def.id); }
    }
    // Arcs: only where a published change coincides with a neighbour's evaluation changing.
    for (const from of changedPublishers) for (const to of neighbours(from, s)) if (changedEvaluations.includes(to)) this.arcs.push({ from, to, t: s.t });
    while (this.arcs.length && this.arcs[0]!.t < s.t - 120) this.arcs.shift();
  }

  private emit(t: number, agent: ComponentId, rule: AnyRule, input: object, outcome: 'fired' | 'cleared'): void {
    const inputs: Record<string, number | boolean | string> = {};
    for (const k of rule.inputs) { const v = (input as Record<string, unknown>)[k]; inputs[k] = typeof v === 'number' ? Math.round(v * 1000) / 1000 : (v as boolean | string); }
    const th = rule.threshold;
    const entry: TraceEntry = {
      seq: ++this.seq, t, agent, ruleId: rule.id, version: rule.version, text: rule.description, inputs,
      threshold: { value: th.value, unit: th.unit, source: th.source + (th.ref ? `, ${th.ref}` : ''), label: th.label },
      outcome, severity: outcome === 'cleared' ? 'info' : rule.severity, narration: '',
    };
    entry.narration = narrateRule(AGENT_NAMES[agent], rule as AnyRule, entry);
    this.feed.push(entry);
    if (this.feed.length > 400) this.feed.shift();
  }

  pushTrace(e: Omit<TraceEntry, 'seq'>): TraceEntry {
    const entry = { ...e, seq: ++this.seq };
    this.feed.push(entry);
    if (this.feed.length > 400) this.feed.shift();
    return entry;
  }

  isActive(agent: ComponentId, ruleId: string): boolean {
    return this.active.get(agent)?.has(ruleId) ?? false;
  }

  /** Active rules at warning or above, in the reported mode. */
  warnings(): { agent: ComponentId; rule: AnyRule }[] {
    const out: { agent: ComponentId; rule: AnyRule }[] = [];
    for (const def of this.defs) for (const id of this.active.get(def.id)!) {
      const rule = (def.rules() as readonly AnyRule[]).find((r) => r.id === id)!;
      if (this.reported(rule) && SEV[rule.severity] >= SEV.warning) out.push({ agent: def.id, rule });
    }
    return out;
  }

  private publishKey(id: ComponentId, s: SimState, level: AgentStatus['level']): string {
    const c = s.C[id];
    if (c.kind === 'tx') return `${level}|${c.live ? 1 : 0}|${Math.floor(c.loadPU * 10)}|${Math.floor(c.temp / 10)}`;
    return `${level}|${c.live ? 1 : 0}|${Math.round(c.mwNow / 25)}`;
  }

  // --- memory -------------------------------------------------------------------------------------
  private updateMemory(s: SimState, dt: number): void {
    const amb = ambientAt(s.t % 86400);
    for (const id of TX_IDS) {
      const c = s.C[id];
      let m = this.tx.get(id);
      if (!m) { m = { hist: [], model: null, minutesAbove100: 0, excessAgeingH: 0, forcedSince: null, shortfallMin: 0, n1Cache: { t: -1e9, minutes: 999 } }; this.tx.set(id, m); }
      // The agent's own model of a healthy unit, driven by the same measured load, ambient and fan stage.
      if (!m.model) m.model = { topOil: c.topOil, dh1: c.dh1, dh2: c.dh2 };
      else {
        const mode = coolingMode({ coolingType: c.coolingType, pumpFailed: false, stage: c.stage }, true);
        const energised = c.live && !c.tripped;
        const next = iecStep(m.model, mode, energised ? c.loadPU : 0, energised, amb, dt);
        m.model = { topOil: next.topOil, dh1: next.dh1, dh2: next.dh2 };
      }
      const res = c.topOil - m.model.topOil;
      m.hist.push({ t: s.t, load: c.loadPU, hs: c.temp, to: c.topOil, res });
      while (m.hist.length && m.hist[0]!.t < s.t - 20 * 60) m.hist.shift();
      m.minutesAbove100 = c.live && c.loadPU > 1 ? m.minutesAbove100 + dt / 60 : 0;
      const v = ageingRate(c.temp);
      if (c.live && v > 1) m.excessAgeingH += ((v - 1) * dt) / 3600;
      m.forcedSince = c.cool ? (m.forcedSince ?? s.t) : null;
      const called = c.temp >= THERMAL.fanStage2On.value ? 2 : c.temp >= THERMAL.fanStage1On.value ? 1 : 0;
      m.shortfallMin = c.live && called > c.stage ? m.shortfallMin + dt / 60 : 0;
    }
  }

  private ago(m: TxMemory, t: number, seconds: number) {
    const target = t - seconds;
    let best = m.hist[0]!;
    for (const h of m.hist) { if (h.t <= target) best = h; else break; }
    return best;
  }

  // --- inputs ------------------------------------------------------------------------------------------
  txInput(s: SimState, id: TransformerId): TxInput {
    const c = s.C[id];
    const m = this.tx.get(id)!;
    const now = m.hist[m.hist.length - 1]!;
    const h5 = this.ago(m, s.t, 300);
    const h10 = this.ago(m, s.t, 600);
    const h15 = this.ago(m, s.t, 900);
    const span5 = Math.max(1, (now.t - h5.t) / 60);
    const hotSpotRateKMin = (now.hs - h5.hs) / span5;
    const loadSteady = Math.abs(now.load - h10.load) < 0.03;
    // Residual growing: each 5-minute sample in the last 15 minutes above the one before.
    const h0 = this.ago(m, s.t, 0);
    const residualGrowing15 = now.t - m.hist[0]!.t >= 900 && h15.res < this.ago(m, s.t, 600).res && this.ago(m, s.t, 600).res < h5.res && h5.res < h0.res;
    const amb = ambientAt(s.t % 86400);
    const stageCalled = c.temp >= THERMAL.fanStage2On.value ? 2 : c.temp >= THERMAL.fanStage1On.value ? 1 : 0;
    const f = this.forecast;
    const partner: TransformerId | null = id === 'T1' ? 'T2' : id === 'T2' ? 'T1' : null;
    const n1LoadPU = partner ? (id === 'T1' ? s.contingency.lossOfT2 : s.contingency.lossOfT1) ?? 0 : 0;
    if (s.t - m.n1Cache.t >= 300) m.n1Cache = { t: s.t, minutes: n1LoadPU > 0 ? minutesTo(c, n1LoadPU, amb, LIMITS.hotSpotNormalCyclic.value) : 999 };
    return {
      energised: c.live, tripped: c.tripped, loadPU: c.loadPU, loadPU10Ago: h10.load, minutesAbove100: m.minutesAbove100,
      projectedLoad30: f ? f.maxLoad30[id] : c.loadPU, hotSpot: c.temp, topOil: c.topOil, ambient: amb, ageingRate: c.ageingRate,
      excessAgeingHours: m.excessAgeingH, hotSpotRateKMin, topOilRise10K: now.to - h10.to, loadSteady,
      expectedTopOil: m.model!.topOil, residualK: now.res, residualGrowing15,
      hotSpotRisingLoadFalling: hotSpotRateKMin > 0.1 && now.load - h10.load < -0.03,
      stage: c.stage, stageCalled, stageShortfallMin: m.shortfallMin, forced: c.cool, forcedHours: m.forcedSince === null ? 0 : (s.t - m.forcedSince) / 3600,
      projectedHotSpot60: f ? f.maxHotSpot60[id] : c.temp, minutesTo120: f ? f.minutesTo120[id] : 999, minutesTo140: f ? f.minutesTo140[id] : 999,
      forecastLoadRise60: f ? f.loadRise60[id] : 0,
      ratingPU: 1 - LIMITS.ambientRatingSlope.value * (amb - 20),
      n1LoadPU, n1MinutesTo120: m.n1Cache.minutes,
    };
  }

  busInput(s: SimState, id: 'BUS400' | 'BUS220A' | 'BUS220B' | 'BUS110'): BusInput {
    const c = s.C[id];
    const section = id === 'BUS220A' ? 'A' : id === 'BUS220B' ? 'B' : null;
    const faulted = section !== null && s.sys.busFault.includes(section);
    const affected = section ? (Object.values(s.C).filter((x) => x.section === section && x.installed && !x.live).length) : 0;
    return { installed: c.installed, energised: c.live, faulted, reenergiseBlocked: faulted, throughMW: c.mwNow, ratingMW: BUS_RATING_MW[id].value, affectedCircuits: affected };
  }

  windInput(s: SimState): WindInput {
    const w = s.C.WIND;
    return { installed: w.installed, windSpeed: w.windSpeed, forecastMaxWind60: this.forecast?.maxWind60 ?? w.windSpeed, outputMW: w.actual, availableMW: w.avail, dispatchedMW: w.out, cutOut: w.cutOut };
  }

  batteryInput(s: SimState): BatteryInput {
    const b = s.C.BESS;
    const mw = b.actual;
    const energy = (b.soc / 100) * b.energyCap;
    const hoursToLimit = mw > 0.5 ? ((b.soc - PLANT.batterySocMin.value) / 100) * b.energyCap / mw : mw < -0.5 ? ((PLANT.batterySocMax.value - b.soc) / 100) * b.energyCap / -mw : 99;
    return { installed: b.installed, soc: b.soc, mw, hoursToLimit, reserveNeededMWh: this.reserveNeededMWh, energyMWh: energy };
  }

  gasInput(s: SimState): GasInput {
    const g = s.C.GAS;
    const starting = g.installed && (g.gasState === 'starting' || (g.gasState === 'running' && g.actual < g.out - 1));
    const minutesToFull = starting ? Math.max(0, (g.out - g.actual) / PLANT.gasRampMwPerMin.value) + (g.gasState === 'starting' ? Math.max(0, PLANT.gasSyncMin.value - g.gasTimer / 60) : 0) : 0;
    return { installed: g.installed, starting, minutesToFull, available: g.avail > 0 };
  }

  demandInput(s: SimState, id: 'LD_TOWN' | 'LD_NEW' | 'LD_IND'): DemandInput {
    const c = s.C[id];
    const per = BASELINE.householdPeakKw.value;
    if (id === 'LD_TOWN') {
      const off = s.results.regional.offSupply;
      return { offSupplyMW: off, shedMW: s.sys.shedMW, households: Math.round(((off + s.sys.shedMW) * 1000) / per), rampingMW: c.mw - c.actual };
    }
    const off = c.installed && c.closed && c.mw > 0.5 && !c.live ? c.mw : 0;
    return { offSupplyMW: off, shedMW: 0, households: 0, rampingMW: c.installed ? c.mw - c.actual : 0 };
  }

  tieInput(s: SimState, id: 'TIE_N' | 'TIE_S' | 'TIE_NI'): TieInput {
    if (id === 'TIE_NI') { const t = s.C.TIE_NI; return { border: true, coupled: s.sys.coupled, transferMW: t.actual, limitMW: t.cap, requestedMW: s.sys.coupled ? t.mw : t.actual }; }
    const t = s.C[id];
    return { border: false, coupled: true, transferMW: t.actual, limitMW: t.cap, requestedMW: t.set };
  }

  infeedInput(s: SimState): InfeedInput {
    const worst = s.contingency.worst;
    return { gridMW: s.results.gridFlow, importLimit: RATINGS.gridImport.value, exportLimit: RATINGS.gridExport.value, n1HeadroomMW: worst > 0 ? (LIMITS.n1SecureLoading.value - worst) * RATINGS.T1.value : 999 };
  }
}

/** Minutes for a unit's hot-spot to reach a limit at a constant load, from its present thermal state (healthy model, full cooling). */
export function minutesTo(c: { topOil: number; dh1: number; dh2: number; coolingType: 'OFAF' | 'ONAF'; temp: number }, loadPU: number, ambient: number, limit: number, maxMin = 120): number {
  if (c.temp >= limit) return 0;
  const mode = coolingMode({ coolingType: c.coolingType, pumpFailed: false, stage: 2 }, true);
  let st = { topOil: c.topOil, dh1: c.dh1, dh2: c.dh2 };
  for (let m = 1; m <= maxMin; m++) {
    const n = iecStep(st, mode, loadPU, true, ambient, 60);
    st = n;
    if (n.hotSpot >= limit) return m;
  }
  return 999;
}

/** Electrical neighbours of an agent (for publishing and arcs). */
export function neighbours(id: ComponentId, s: SimState): ComponentId[] {
  const onSection = (sec: 'A' | 'B') => (Object.keys(s.C) as ComponentId[]).filter((k) => s.C[k].section === sec);
  switch (id) {
    case 'T1': return ['T2', 'BUS400', 'BUS220A'];
    case 'T2': return ['T1', 'BUS400', 'BUS220B'];
    case 'T3': return ['BUS220B', 'BUS110'];
    case 'T4': return ['BUS220B', 'TIE_NI'];
    case 'BUS400': return ['GRID', 'T1', 'T2'];
    case 'BUS220A': return ['T1', ...onSection('A')];
    case 'BUS220B': return ['T2', 'T3', 'T4', ...onSection('B')];
    case 'BUS110': return ['T3', 'LD_IND', 'TIE_S'];
    case 'GRID': return ['BUS400'];
    case 'TIE_NI': return ['T4'];
    case 'LD_IND': case 'TIE_S': return ['BUS110'];
    default: { const sec = s.C[id].section; return sec ? [sec === 'A' ? 'BUS220A' : 'BUS220B'] : []; }
  }
}

