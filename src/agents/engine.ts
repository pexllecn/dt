import { conductors } from '@/config/network';
import { operation } from '@/config/system';
import { Prng } from '@/sim/prng';
import { STEPS, growth, type DayResult, type Engine } from '@/sim/engine';
import { ptdf } from '@/sim/powerflow';
import { blowoutAngle, conductorTemperature, sagAt } from '@/sim/thermal';
import { siteSpeed, frontBoost, type WindScenario } from '@/sim/wind';
import { ageingRate, hotSpot, topOil } from './transformerModel';
import { ruleSets, RULESET_VERSION, ruleSetHash } from './rules';
import type {
  BatteryInput,
  CoordinatorInput,
  InterconnectorInput,
  LargeLoadInput,
  LineInput,
  SubstationInput,
  TransformerInput,
  WindFarmInput,
} from './inputs';
import type { AssetType, Rule, TraceEntry } from './types';

/** Counties whose agents lose communications in the storm scenario ("Region W"). */
export const REGION_W = ['Mayo', 'Galway', 'Sligo', 'Roscommon', 'Leitrim'];

export interface AgentInfo {
  id: string;
  type: AssetType;
  name: string;
  e: number;
  n: number;
  county: string;
  /** Branch id (lines, transformers) or bus id (others) the agent watches. */
  ref: string;
  /** Neighbouring agents (sharing a bus) whose published state this agent reads. */
  neighbours: string[];
}

export interface Recommendation {
  id: string;
  step: number;
  kind: 'redispatch' | 'battery' | 'connection';
  title: string;
  /** Plain-English rationale. */
  summary: string;
  targetBranch: string;
  targetLabel: string;
  contingency: string | null;
  beforeLoading: number;
  afterLoading: number;
  actions: { assetId: string; assetName: string; bus: string; deltaMW: number; stale: boolean }[];
  method: string;
  rulesFired: string[];
  confidence: number;
  withheld: { assetName: string; reason: string }[];
  ruleSetVersion: string;
  ruleSetHash: string;
}

export interface AgentOptions {
  scenarioWind: WindScenario;
  ambientC: number;
  humidityPct: number;
  /** Communications lost to Region W from this step (null = no loss). */
  commsLostFromStep: number | null;
  /** 'consistency' withholds actions on stale assets; 'availability' uses last known state, flagged. */
  stalePolicy: 'consistency' | 'availability';
  /** Steps at which named branches tripped (for auto-reclose counts in the storm). */
  tripSteps: Record<string, number>;
}

export interface AgentDay {
  agents: AgentInfo[];
  trace: TraceEntry[];
  recommendations: Recommendation[];
  /** Per agent, per step: highest severity firing (0 none, 1 info, 2 advisory, 3 warning, 4 critical), [step * nAgents + agent]. */
  level: Uint8Array;
  /** Same, counting base rules only (to show what the extended set adds). */
  levelBase: Uint8Array;
  confidence: Float32Array;
  ruleSetVersion: string;
  ruleSetHash: string;
}

const sevRank = { info: 1, advisory: 2, warning: 3, critical: 4 } as const;
const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

/** Seeded condition-monitoring data per asset, with a few planted anomalies the extended rules should catch. */
function conditionLine(id: string, label: string) {
  const r = new Prng(hashStr(id));
  const c = {
    autoReclosesToday: 0,
    faults12m: Math.floor(r.next() * 3.2),
    vegetationSurveyMonths: Math.floor(6 + r.next() * 34),
    ageYears: Math.floor(15 + r.next() * 45),
    insulatorDefects: r.next() < 0.05 ? 1 : 0,
    towerCorrosionGrade: 1 + Math.floor(r.next() * 3.6),
    thermographyHotspotC: Math.round(2 + r.next() * 14),
    outageRequestsPending: r.next() < 0.03 ? 1 : 0,
  };
  // Planted: an overdue survey and a hot joint on the north Mayo 110 kV pair (hero scenario context).
  if (/Glenree to Cunghill/.test(label)) c.thermographyHotspotC = 26;
  if (/Bellacorick to Castlebar/.test(label)) c.vegetationSurveyMonths = 41;
  return c;
}

function conditionTx(id: string, label: string) {
  const r = new Prng(hashStr(id));
  const c = {
    h2: Math.round(15 + r.next() * 60),
    ch4: Math.round(8 + r.next() * 30),
    c2h2: Math.round(r.next() * 8) / 10,
    c2h4: Math.round(5 + r.next() * 25),
    c2h6: Math.round(8 + r.next() * 30),
    co: Math.round(150 + r.next() * 450),
    co2: Math.round(1800 + r.next() * 3000),
    c2h2Rate: 0,
    h2Rate: Math.round(r.next() * 5),
    moisturePpm: Math.round(6 + r.next() * 14),
    tapOps24h: Math.round(5 + r.next() * 25),
    tapOpsSinceService: Math.round(20_000 + r.next() * 70_000),
    bushingTanDeltaPct: Math.round((0.25 + r.next() * 0.4) * 100) / 100,
    bushingCapChangePct: Math.round(r.next() * 25) / 10,
    coolingFault: false,
    oilLevelPct: Math.round(88 + r.next() * 10),
    buchholzAlarm: false,
    ageYears: Math.floor(8 + r.next() * 40),
  };
  // Planted: an acetylene trend on a north-western 220/110 kV group. Base rules do not see it.
  if (/Srananagh/.test(label)) Object.assign(c, { c2h2: 4.6, c2h2Rate: 1.3, ch4: 14, c2h4: 9, h2: 95, h2Rate: 12 });
  return c;
}

export class AgentEngine {
  private readonly sim: Engine;
  readonly agents: AgentInfo[] = [];
  private outages: number[] = [];

  constructor(sim: Engine) {
    this.sim = sim;
    const m = sim.model;
    const busBranches = new Map<number, string[]>();
    m.branches.forEach((b) => {
      for (const bus of [b.from, b.to]) (busBranches.get(bus) ?? busBranches.set(bus, []).get(bus)!).push(`A-${b.id}`);
    });
    for (const b of m.branches) {
      const na = m.buses[b.from]!.node;
      const nz = m.buses[b.to]!.node;
      const neighbours = [...new Set([...(busBranches.get(b.from) ?? []), ...(busBranches.get(b.to) ?? [])])].filter((x) => x !== `A-${b.id}`);
      this.agents.push({
        id: `A-${b.id}`,
        type: b.kind === 'transformer' ? 'transformer' : 'line',
        name: b.label,
        e: (na.e + nz.e) / 2,
        n: (na.n + nz.n) / 2,
        county: na.county,
        ref: b.id,
        neighbours,
      });
    }
    const seenNode = new Set<string>();
    for (const bus of m.buses) {
      if (bus.node.kind !== 'station' || seenNode.has(bus.node.id)) continue;
      seenNode.add(bus.node.id);
      const idxs = m.buses.filter((x) => x.node.id === bus.node.id).map((x) => x.idx);
      const neighbours = idxs.flatMap((i) => busBranches.get(i) ?? []);
      if (!neighbours.length) continue;
      this.agents.push({ id: `S-${bus.node.id}`, type: 'substation', name: bus.node.name, e: bus.node.e, n: bus.node.n, county: bus.node.county, ref: bus.id, neighbours });
    }
    m.wind.forEach((w, i) => {
      const b = m.buses[w.bus]!;
      this.agents.push({ id: `W-${i}`, type: 'windfarm', name: `${w.name} wind cluster`, e: w.e, n: w.n, county: b.node.county, ref: b.id, neighbours: busBranches.get(w.bus) ?? [] });
    });
    m.batteries.forEach((bt, i) => {
      const b = m.buses[bt.bus]!;
      this.agents.push({ id: `B-${i}`, type: 'battery', name: `${bt.name} battery`, e: b.node.e, n: b.node.n, county: b.node.county, ref: b.id, neighbours: busBranches.get(bt.bus) ?? [] });
    });
    m.largeLoads.forEach((ll) => {
      const b = m.buses[ll.bus]!;
      this.agents.push({ id: `L-${ll.id}`, type: 'largeload', name: ll.name, e: b.node.e, n: b.node.n, county: b.node.county, ref: b.id, neighbours: busBranches.get(ll.bus) ?? [] });
    });
    m.interconnectors.forEach((ic) => {
      const b = m.buses[ic.bus]!;
      this.agents.push({ id: `I-${ic.spec.id}`, type: 'interconnector', name: `${ic.spec.name} interconnector`, e: b.node.e, n: b.node.n, county: b.node.county, ref: b.id, neighbours: busBranches.get(ic.bus) ?? [] });
    });
    this.agents.push({ id: 'COORD', type: 'coordinator', name: 'Coordinator', e: 600_000, n: 760_000, county: '', ref: '', neighbours: [] });
  }

  run(day: DayResult, opts: AgentOptions, icShare: number, outagesAt: (step: number) => number[], yearInputs: { year: number }): AgentDay {
    const m = this.sim.model;
    const nb = m.branches.length;
    const nA = this.agents.length;
    const level = new Uint8Array(STEPS * nA);
    const levelBase = new Uint8Array(STEPS * nA);
    const confidence = new Float32Array(STEPS).fill(1);
    const trace: TraceEntry[] = [];
    const recommendations: Recommendation[] = [];
    const active = new Map<string, boolean>(); // agentId|ruleId -> firing
    const hash = ruleSetHash();
    let seq = 0;
    const branchById = new Map(m.branches.map((b) => [b.id, b]));
    let outSet = new Set<number>();
    const episodes = new Set<number>();
    const region = new Set(REGION_W);
    const staleAt = (a: AgentInfo, s: number) => opts.commsLostFromStep !== null && s >= opts.commsLostFromStep && region.has(a.county);

    // Accumulators
    const hours90 = new Float64Array(nb);
    const hoursN1 = new Float64Array(nb);
    const ageing = new Float64Array(nb);
    const lastFresh = new Map<string, unknown>();
    const lineCond = new Map<string, ReturnType<typeof conditionLine>>();
    const txCond = new Map<string, ReturnType<typeof conditionTx>>();
    const soc = m.batteries.map(() => 0.55);

    const maxAt = (busId: string, arr: Float32Array, off: number) => {
      const bi = m.busIndex.get(busId)!;
      let v = 0;
      for (const b of m.branches) if (b.from === bi || b.to === bi) v = Math.max(v, arr[off + b.idx]!);
      return v;
    };

    for (let s = 0; s < STEPS; s++) {
      const h = s * 0.25;
      const off = s * nb;
      let staleCount = 0;
      this.outages = outagesAt(s);
      outSet = new Set(this.outages);
      const evaluate = <I>(a: AgentInfo, idx: number, rules: Rule<I>[], input: I, stale: boolean) => {
        let lvl = 0;
        let lvlBase = 0;
        for (const rule of rules) {
          const key = `${a.id}|${rule.id}`;
          const fired = rule.condition(input, rule.threshold.value);
          const was = active.get(key) ?? false;
          if (fired) {
            lvl = Math.max(lvl, sevRank[rule.severity]);
            if (rule.maturity === 'base') lvlBase = Math.max(lvlBase, sevRank[rule.severity]);
          }
          if (fired !== was) {
            active.set(key, fired);
            const shown: Record<string, number | string | boolean> = {};
            for (const k of rule.inputs) {
              const v = (input as Record<string, unknown>)[k];
              shown[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : (v as string | boolean);
            }
            trace.push({
              seq: seq++,
              step: s,
              agentId: a.id,
              agentType: a.type,
              agentName: a.name,
              ruleId: rule.id,
              ruleVersion: rule.version,
              ruleText: rule.description,
              maturity: rule.maturity,
              severity: rule.severity,
              event: fired ? 'fired' : 'cleared',
              inputs: shown,
              measure: Math.round(rule.measure(input) * 100) / 100,
              threshold: rule.threshold,
              outcome: fired ? rule.outcome : 'Condition no longer present.',
              e: a.e,
              n: a.n,
              ref: a.ref,
              stale,
            });
          }
        }
        level[s * nA + idx] = lvl;
        levelBase[s * nA + idx] = lvlBase;
      };

      this.agents.forEach((a, idx) => {
        const stale = staleAt(a, s);
        if (stale) staleCount++;
        const key = a.id;
        if (a.type === 'line' || a.type === 'transformer') {
          const b = branchById.get(a.ref)!;
          const tripped = outSet.has(b.idx);
          const loading = day.loading[off + b.idx]!;
          const n1 = day.n1Loading[off + b.idx]!;
          const cause = day.n1Cause[off + b.idx]!;
          if (loading > 0.9) hours90[b.idx] = hours90[b.idx]! + 0.25;
          if (n1 > 1) hoursN1[b.idx] = hoursN1[b.idx]! + 0.25;
          if (a.type === 'line') {
            const kv = b.kv;
            const cond = lineCond.get(key) ?? lineCond.set(key, conditionLine(key, b.label)).get(key)!;
            const wind = siteSpeed(opts.scenarioWind, a.e, a.n, h, 0);
            const temp = conductorTemperature(kv, loading, opts.ambientC, wind);
            const cc = conductors[kv >= 300 ? 400 : kv >= 250 ? 275 : kv >= 200 ? 220 : 110]!;
            const design = cc.maxDesignTempC.value;
            const ratingFactor = Math.sqrt(Math.sqrt(Math.max(wind, 0.6) / 0.6) * Math.max(0, (design - opts.ambientC) / (design - 15)));
            const prevLoading = s >= 4 ? day.loading[(s - 4) * nb + b.idx]! : loading;
            const storm = frontBoost(opts.scenarioWind.front, a.e, h) > 6;
            const tripStep = opts.tripSteps[b.id];
            let input: LineInput = {
              kv,
              lengthKm: b.lengthKm,
              loading,
              n1Loading: n1,
              n1Cause: cause >= 0 ? this.sim.contingencyLabel(cause) : 'none',
              mw: day.flows[off + b.idx]!,
              tripped,
              conductorTempC: temp,
              designTempC: design,
              clearanceMarginM: sagAt(kv, design) - sagAt(kv, temp),
              windMs: wind,
              ambientC: opts.ambientC,
              humidityPct: opts.humidityPct,
              hoursAbove90: hours90[b.idx]!,
              hoursN1Above100: hoursN1[b.idx]!,
              cable: b.kind === 'cable',
              loadingRampPerHour: loading - prevLoading,
              dlrHeadroom: ratingFactor - 1,
              ...cond,
              autoReclosesToday: tripStep !== undefined && s >= tripStep - 2 ? 2 : 0,
              lightningKm: storm ? 4 : 999,
              stale,
            };
            void blowoutAngle;
            if (stale) input = { ...((lastFresh.get(key) as LineInput) ?? input), stale: true, tripped };
            else lastFresh.set(key, input);
            evaluate(a, idx, ruleSets.line as unknown as Rule<LineInput>[], input, stale);
          } else {
            const cond = txCond.get(key) ?? txCond.set(key, conditionTx(key, b.label)).get(key)!;
            const K = loading;
            const hs = hotSpot(opts.ambientC, K);
            const v = ageingRate(hs);
            ageing[b.idx] = ageing[b.idx]! + v * 0.25;
            let input: TransformerInput = {
              loading,
              n1Loading: n1,
              units: b.unit?.count ?? 2,
              ambientC: opts.ambientC,
              topOilC: topOil(opts.ambientC, K),
              hotSpotC: hs,
              ageingRate: v,
              ageingHoursToday: ageing[b.idx]!,
              ...cond,
              stale,
            };
            if (stale) input = { ...((lastFresh.get(key) as TransformerInput) ?? input), stale: true };
            else lastFresh.set(key, input);
            evaluate(a, idx, ruleSets.transformer as unknown as Rule<TransformerInput>[], input, stale);
          }
        } else if (a.type === 'substation') {
          const ids = a.neighbours.map((n) => branchById.get(n.slice(2))!).filter(Boolean);
          const input: SubstationInput = {
            kv: Math.max(...ids.map((b) => b.kv)),
            circuits: ids.length,
            circuitsOut: ids.filter((b) => outSet.has(b.idx)).length,
            maxBranchLoading: Math.max(...ids.map((b) => day.loading[off + b.idx]!)),
            maxN1Loading: Math.max(...ids.map((b) => day.n1Loading[off + b.idx]!)),
            protectionHealthy: true,
            batteryChargerOk: true,
            commsOk: !stale,
            securityAlarm: false,
            stale,
          };
          evaluate(a, idx, ruleSets.substation as unknown as Rule<SubstationInput>[], input, stale);
        } else if (a.type === 'windfarm') {
          const wi = Number(a.id.slice(2));
          const cl = m.wind[wi]!;
          const mw = day.windMW[s * m.wind.length + wi]!;
          const g = growth(yearInputs.year);
          const capacity = cl.share * (cl.country === 'ROI' ? g.windRoi : g.windNi);
          const curtailed = day.series.windAvail[s]! > 0 ? 1 - day.series.wind[s]! / day.series.windAvail[s]! : 0;
          const input: WindFarmInput = {
            capacityMW: capacity,
            mw,
            availableMW: mw / Math.max(1e-6, 1 - curtailed),
            curtailedShare: curtailed,
            windMs: day.windSpeed[s * m.wind.length + wi]!,
            cutOutMs: 25,
            exportLoading: maxAt(a.ref, day.loading, off),
            turbinesAvailable: 0.96,
            stale,
          };
          evaluate(a, idx, ruleSets.windfarm as unknown as Rule<WindFarmInput>[], input, stale);
        } else if (a.type === 'battery') {
          const bi = Number(a.id.slice(2));
          const bt = m.batteries[bi]!;
          const mw = day.series.battery[s]! * bt.share;
          const cap = Math.max(1, Math.abs(day.series.battery.reduce((x, y) => Math.max(x, Math.abs(y)), 0)) * bt.share * 4);
          soc[bi] = Math.min(1, Math.max(0, soc[bi]! - (mw * 0.25) / cap));
          const input: BatteryInput = {
            capacityMW: cap,
            energyMWh: cap,
            soc: soc[bi]!,
            mw,
            cellTempC: 24,
            cyclesToday: 0.6,
            corridorN1: maxAt(a.ref, day.n1Loading, off),
            stale,
          };
          evaluate(a, idx, ruleSets.battery as unknown as Rule<BatteryInput>[], input, stale);
        } else if (a.type === 'largeload') {
          const ll = m.largeLoads.find((x) => `L-${x.id}` === a.id)!;
          const mw = ll.share * day.series.dc[s]! + ll.mw;
          const input: LargeLoadInput = {
            mw,
            contractedMW: ll.hypothetical ? ll.mw : mw * 1.15,
            firmMW: ll.hypothetical ? ll.mw : mw * 1.15,
            flexibleMW: 0,
            feedN1: maxAt(a.ref, day.n1Loading, off),
            backupFuelHours: 48,
            hypothetical: ll.hypothetical,
            stale,
          };
          if (ll.hypothetical && ll.mw <= 0) return;
          evaluate(a, idx, ruleSets.largeload as unknown as Rule<LargeLoadInput>[], input, stale);
        } else if (a.type === 'interconnector') {
          const ic = m.interconnectors.find((x) => `I-${x.spec.id}` === a.id)!;
          if (yearInputs.year < ic.spec.from) return;
          const mw = icShare * ic.spec.capacity.value;
          const input: InterconnectorInput = {
            mw,
            capacityMW: ic.spec.capacity.value,
            scheduleMW: mw,
            stationN1: maxAt(a.ref, day.n1Loading, off),
            snsp: day.series.snsp[s]!,
            snspCap: operation.snspCap.value,
            stale,
          };
          evaluate(a, idx, ruleSets.interconnector as unknown as Rule<InterconnectorInput>[], input, stale);
        }
      });

      // ---- coordinator
      let overloadsN = 0;
      let overloadsN1 = 0;
      let worst = 0;
      for (let l = 0; l < nb; l++) {
        if (outSet.has(l)) continue;
        const ld = day.loading[off + l]!;
        const n1 = day.n1Loading[off + l]!;
        if (ld > 1) overloadsN++;
        if (n1 > 1) overloadsN1++;
        worst = Math.max(worst, n1);
      }
      const staleShare = staleCount / Math.max(1, nA);
      confidence[s] = Math.max(0, 1 - staleShare * 3);
      const coordIdx = nA - 1;
      const cIn: CoordinatorInput = {
        overloadsN,
        overloadsN1,
        worstN1: worst,
        snsp: day.series.snsp[s]!,
        snspCap: operation.snspCap.value,
        curtailedMW: day.series.curtailed[s]!,
        staleShare,
        unservedMW: day.series.unserved[s]!,
      };
      evaluate(this.agents[coordIdx]!, coordIdx, ruleSets.coordinator as unknown as Rule<CoordinatorInput>[], cIn, false);
      // COORD-001: one proposal per overload episode. An episode starts when a circuit goes above
      // its rating and ends when it falls below 97%; the worst new episode is proposed first.
      let newWorst = -1;
      for (let l = 0; l < nb; l++) {
        const ld = outSet.has(l) ? 0 : day.loading[off + l]!;
        if (episodes.has(l)) {
          if (ld < 0.97) episodes.delete(l);
        } else if (ld > 1) {
          episodes.add(l);
          if (newWorst < 0 || ld > day.loading[off + newWorst]!) newWorst = l;
        }
      }
      if (newWorst >= 0 && active.get(`${this.agents[coordIdx]!.id}|COORD-001`)) {
        const rec = this.redispatch(day, s, newWorst, -1, opts, staleAt, hash);
        if (rec) recommendations.push(rec);
      }
    }
    return { agents: this.agents, trace, recommendations, level, levelBase, confidence, ruleSetVersion: RULESET_VERSION, ruleSetHash: hash };
  }

  /**
   * METHOD-REDISPATCH-01: relieve branch l (or its post-contingency flow after losing k) by moving
   * generation from the injection with the largest positive sensitivity to the one with the most
   * negative, cheapest first, within available headroom. Sensitivities from the DC model (PTDF).
   */
  redispatch(day: DayResult, s: number, l: number, k: number, opts: AgentOptions, staleAt: (a: AgentInfo, s: number) => boolean, hash: string): Recommendation | null {
    const m = this.sim.model;
    const nb = m.branches.length;
    const solver = this.sim.solverFor(this.outages);
    const b = m.branches[l]!;
    const off = s * nb;
    const flow = day.flows[off + l]!;
    const rating = day.ratings[l]!;
    const excess = Math.abs(flow) - rating * 0.97;
    if (excess <= 0) return null;
    const dir = Math.sign(flow) || 1;
    const sens = (bus: number) => dir * ptdf(solver, m.branches, l, bus);
    type Cand = { id: string; name: string; bus: number; room: number; sens: number; cost: number; stale: boolean };
    const down: Cand[] = [];
    const up: Cand[] = [];
    const agentFor = (busIdx: number) => this.agents.find((a) => a.ref === m.buses[busIdx]!.id);
    m.wind.forEach((w, i) => {
      const mw = day.windMW[s * m.wind.length + i]!;
      if (mw < 1) return;
      const a = agentFor(w.bus);
      down.push({ id: `W-${i}`, name: `${w.name} wind cluster`, bus: w.bus, room: mw, sens: sens(w.bus), cost: 0, stale: a ? staleAt(a, s) : false });
    });
    m.units.forEach((u) => {
      const mw = day.unitMW[s * m.units.length + u.idx]!;
      const a = agentFor(u.bus);
      const st = a ? staleAt(a, s) : false;
      if (mw > 1) down.push({ id: u.spec.id, name: u.spec.name, bus: u.bus, room: mw - (mw > u.min ? u.min : 0), sens: sens(u.bus), cost: -u.spec.cost, stale: st });
      if (u.capacity - mw > 1) up.push({ id: u.spec.id, name: u.spec.name, bus: u.bus, room: u.capacity - mw, sens: sens(u.bus), cost: u.spec.cost, stale: st });
    });
    m.batteries.forEach((bt, i) => {
      const a = agentFor(bt.bus);
      up.push({ id: `B-${i}`, name: `${bt.name} battery`, bus: bt.bus, room: 15, sens: sens(bt.bus), cost: 60, stale: a ? staleAt(a, s) : false });
    });
    // Under the consistency policy, stale assets are not used; the most effective of them are
    // named as withheld so the operator sees what the policy cost.
    const consistency = opts.stalePolicy === 'consistency';
    const ok = (c: Cand) => !(c.stale && consistency);
    const downsAll = down.filter((c) => c.sens > 0.02).sort((x, y) => y.sens - x.sens || x.cost - y.cost);
    const downs = downsAll.filter(ok);
    const topDown = downs[0]?.sens ?? 0;
    const ups = up.filter((c) => c.sens < topDown - 0.05 && ok(c)).sort((x, y) => (Math.abs(x.sens - y.sens) > 0.02 ? x.sens - y.sens : x.cost - y.cost));
    const withheld: Recommendation['withheld'] = consistency
      ? downsAll
          .filter((c) => c.stale && c.sens > topDown)
          .slice(0, 4)
          .map((c) => ({ assetName: c.name, reason: 'state stale (communications lost); withheld under the consistency policy' }))
      : [];
    const actions: Recommendation['actions'] = [];
    let remaining = excess * 1.05;
    for (const d of downs.slice(0, 4)) {
      const u = ups.find((x) => x.room > 1 && d.sens - x.sens >= 0.05);
      if (!u || remaining <= 0) break;
      const eff = d.sens - u.sens;
      const mw = Math.min(d.room, u.room, remaining / eff);
      if (mw < 1) continue;
      actions.push({ assetId: d.id, assetName: d.name, bus: m.buses[d.bus]!.id, deltaMW: -Math.round(mw), stale: d.stale });
      actions.push({ assetId: u.id, assetName: u.name, bus: m.buses[u.bus]!.id, deltaMW: Math.round(mw), stale: u.stale });
      u.room -= mw;
      remaining -= mw * eff;
    }
    if (!actions.length) return null;
    const relieved = excess * 1.05 - Math.max(0, remaining);
    const after = (Math.abs(flow) - relieved) / rating;
    void k;
    return {
      id: `R-${s}-${b.id}`,
      step: s,
      kind: 'redispatch',
      title: `Relieve ${b.label}`,
      summary: `${b.label} is at ${Math.round((100 * Math.abs(flow)) / rating)}% of its rating. Moving generation away from the injections that load it most, and towards those that unload it, brings it to about ${Math.round(after * 100)}%.`,
      targetBranch: b.id,
      targetLabel: b.label,
      contingency: null,
      beforeLoading: Math.abs(flow) / rating,
      afterLoading: after,
      actions,
      method: 'METHOD-REDISPATCH-01 (sensitivity-based re-dispatch, DC model)',
      rulesFired: ['COORD-001', 'LINE-B-001'],
      // Withheld assets cost effectiveness; acting on stale state costs confidence.
      confidence: Math.max(0.3, 1 - withheld.length * 0.05 - actions.filter((a) => a.stale).length * 0.08),
      withheld,
      ruleSetVersion: RULESET_VERSION,
      ruleSetHash: hash,
    };
  }
}
