import { demand, dcAverageMW2025, renewables, storage } from '@/config/system';
import { sunPosition, irishLocalToUtc } from '@/lib/solar';
import { buildModel, setTransformerUnits, type Model } from './model';
import { buildSolver, ptdf, type DCSolver } from './powerflow';
import { dayType, dcShape, nonDcShape } from './profiles';
import { dispatch } from './dispatch';
import { powerCurve, siteSpeed, type WindScenario } from './wind';
import type { NetworkBundle } from './types';

export const STEPS = 96; // 15-minute intervals
export const STEP_H = 0.25;

export interface EngineInputs {
  date: { y: number; m: number; d: number };
  /** Growth slider year, 2026 to 2034. */
  year: number;
  wind: WindScenario;
  /** Interconnector schedule as a share of capacity: -1 full export .. +1 full import. */
  icShare: number;
  /** Extra demand at buses (MW), from the Load tool or a connection request. */
  extraLoad: Record<number, number>;
  /** Branches out of service all day (index into model.branches). */
  outages: number[];
  /** Branches that trip part-way through the day: out from this step onwards. */
  timedOutages?: { branch: number; fromStep: number }[];
  /** Approved actions: MW added at a bus from a step onwards (re-dispatch pairs sum to zero). */
  adjustments?: { bus: number; deltaMW: number; fromStep: number; windCluster?: number }[];
  /** Units unavailable (index into model.units). */
  unitOutages: number[];
  /**
   * Day-ahead constraint management on the planned network (default on): generation is moved
   * so no circuit is scheduled above 95% of its rating with everything planned in service.
   * Events after the schedule (timed trips) are left for the agents and the operator.
   */
  scheduleConstraints?: boolean;
}

/** Scheduling limit as a share of rating, and the most MW moved per interval for constraints. */
const SCHED_LIMIT = 0.95;
const SCHED_MAX_MW = 900;
/** Post-fault limit used by the scheduler: short-term emergency rating as a share of continuous (Assumption). */
const SCHED_N1_LIMIT = 1.2;

export type SeriesKey =
  | 'demand'
  | 'roiDemand'
  | 'niDemand'
  | 'dc'
  | 'windAvail'
  | 'wind'
  | 'solar'
  | 'curtailed'
  | 'constrained'
  | 'imports'
  | 'thermal'
  | 'battery'
  | 'snsp'
  | 'dcShare'
  | 'unserved'
  | 'islandedMW';

export const SERIES: SeriesKey[] = [
  'demand',
  'roiDemand',
  'niDemand',
  'dc',
  'windAvail',
  'wind',
  'solar',
  'curtailed',
  'constrained',
  'imports',
  'thermal',
  'battery',
  'snsp',
  'dcShare',
  'unserved',
  'islandedMW',
];

export interface DayResult {
  nBranches: number;
  /** Signed MW, from-bus to to-bus, [step * nb + branch]. */
  flows: Float32Array;
  /** |flow| / rating. */
  loading: Float32Array;
  /** Worst post-contingency loading over all single outages. */
  n1Loading: Float32Array;
  /** Contingency (branch index) causing n1Loading, or -1. */
  n1Cause: Int16Array;
  /** Branch ratings in MVA for this date (season). */
  ratings: Float32Array;
  series: Record<SeriesKey, Float32Array>;
  /** Unit output MW [step * nUnits + unit]. */
  unitMW: Float32Array;
  /** Net injection per bus MW [step * nBus + bus]. */
  injections: Float32Array;
  /** Bus load MW [step * nBus + bus]. */
  busLoad: Float32Array;
  /** Wind dispatched per cluster [step * nClusters + c]. */
  windMW: Float32Array;
  /** Wind speed per cluster (m/s). */
  windSpeed: Float32Array;
  islanding: Uint8Array;
  energised: Uint8Array;
}

const smooth01 = (x: number) => Math.min(1, Math.max(0, x));

export function seasonRating(month: number, winter: number, summer: number): number {
  if (month >= 11 || month <= 3) return winter;
  if (month >= 5 && month <= 8) return summer;
  return (winter + summer) / 2;
}

let shapeMeanCache: number | null = null;
/** Annual mean of the non-data-centre demand shape (fraction of winter weekday peak). */
export function annualShapeMean(): number {
  if (shapeMeanCache !== null) return shapeMeanCache;
  let sum = 0;
  let n = 0;
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= 28; d += 3) {
      const type = dayType(2026, m, d);
      for (let h = 0; h < 24; h += 0.5) {
        sum += nonDcShape(h, m, d, type);
        n++;
      }
    }
  }
  shapeMeanCache = sum / n;
  return shapeMeanCache;
}

/** Growth factors for the year slider. */
export function growth(year: number) {
  const t = smooth01((year - 2026) / 8);
  const nonDc = (1 + demand.nonDcGrowthPerYear.value) ** (year - 2026);
  const dc2026 = dcAverageMW2025 * demand.dcGrowth2026.value;
  // Data centre demand reaching 31% of ROI demand by 2034 (EirGrid forecast cited by the CRU),
  // measured against the model's own annual non-data-centre energy so the share is consistent.
  const roiNonDcPeak = demand.roiWinterPeak.value - dc2026;
  const nonDcAvg2026 = roiNonDcPeak * annualShapeMean();
  const nonDcAvg2034 = nonDcAvg2026 * (1 + demand.nonDcGrowthPerYear.value) ** 8;
  const s = demand.dcShare2034.value;
  const dc2034 = (s / (1 - s)) * nonDcAvg2034;
  const dc = dc2026 * (dc2034 / dc2026) ** t;
  return {
    nonDc,
    dcMW: dc,
    windRoi: renewables.windRoi2026.value + (renewables.windRoi2034.value - renewables.windRoi2026.value) * t,
    windNi: renewables.windNi2026.value,
    offshore: renewables.offshore2034.value * t,
    solar: renewables.solarRoi2026.value + (renewables.solarRoi2034.value - renewables.solarRoi2026.value) * t,
    battery: storage.batteryRoi2026.value * (1 + 1.5 * t),
  };
}

export class Engine {
  readonly model: Model;
  private solver: DCSolver | null = null;
  private solverKey = '';
  private readonly solverCache = new Map<string, DCSolver>();
  /** Share of each branch lost in its N-1 contingency: one circuit or one transformer unit. */
  alpha = new Float64Array(0);

  constructor(bundle: NetworkBundle) {
    this.model = buildModel(bundle);
    this.updateAlpha();
    this.sizeTransformers();
    this.updateAlpha();
  }

  private updateAlpha(): void {
    this.alpha = Float64Array.from(this.model.branches, (b) => 1 / (b.unit ? b.unit.count : b.circuits));
  }

  /** Plain-English name of the N-1 contingency for branch k. */
  contingencyLabel(k: number): string {
    const b = this.model.branches[k]!;
    if (b.unit) return `loss of one ${b.label.replace(/ transformers$/, ' transformer')}`;
    if (b.circuits > 1) return `loss of one circuit of ${b.label}`;
    return `loss of ${b.label}`;
  }

  /**
   * Transformer unit counts are not in the map data. Stations are planned so that, with one unit
   * out, the rest carry the peak: size each station's units against a reference winter weekday
   * evening (18:00, moderate wind), allowing 10% margin, minimum two units. (Assumption, stated
   * in the Method notes.)
   */
  private sizeTransformers(): void {
    const m = this.model;
    for (let pass = 0; pass < 2; pass++) {
      this.resetSolvers();
      const day = this.runDay({
        date: { y: 2026, m: 1, d: 14 },
        year: 2026,
        wind: { reference: () => 8, seed: 11, scale: 1 },
        icShare: 0.2,
        extraLoad: {},
        outages: [],
        unitOutages: [],
      });
      const nb = m.branches.length;
      for (const b of m.branches) {
        if (!b.unit) continue;
        let peak = 0;
        for (let s = 56; s < 84; s++) peak = Math.max(peak, Math.abs(day.flows[s * nb + b.idx]!));
        const need = Math.max(2, Math.ceil((peak * 1.1) / b.unit.ratingMVA) + 1);
        setTransformerUnits(b, Math.max(b.unit.count, need));
      }
    }
    this.resetSolvers();
  }

  solverFor(outages: number[]): DCSolver {
    const key = [...outages].sort((a, b) => a - b).join(',');
    if (this.solver && key === this.solverKey) return this.solver;
    let s = this.solverCache.get(key);
    if (!s) {
      s = buildSolver(this.model.buses.length, this.model.branches, new Set(outages), this.model.slack);
      if (this.solverCache.size > 6) this.solverCache.clear();
      this.solverCache.set(key, s);
    }
    this.solver = s;
    this.solverKey = key;
    return s;
  }

  /** Branches out of service at a given step. */
  outagesAt(inp: EngineInputs, step: number): number[] {
    const timed = (inp.timedOutages ?? []).filter((t) => step >= t.fromStep).map((t) => t.branch);
    return [...new Set([...inp.outages, ...timed])];
  }

  /** Clears cached solvers (after transformer sizing changes reactances). */
  resetSolvers(): void {
    this.solver = null;
    this.solverCache.clear();
  }

  /**
   * Day-ahead constraint management (METHOD-SCHED-01). On the planned topology, first keep every
   * circuit below the scheduling limit with everything in service, then keep the worst single
   * outage below the short-term emergency limit (preventive N-1). Each step moves generation from
   * the injection that loads the constraint most (wind first, then thermal above minimum) to the
   * unit that unloads it most, using PTDF (and LODF) sensitivities. Mutates injections, unit
   * output and cluster wind.
   */
  private constrain(
    inj: Float64Array,
    unitMW: Float64Array,
    windMW: Float32Array,
    ratings: Float32Array,
    planned: number[],
    available: (u: number) => boolean,
  ): { moved: number; windDown: number } {
    const m = this.model;
    const nb = m.branches.length;
    const sched = this.solverFor(planned);
    const flows = new Float64Array(nb);
    let moved = 0;
    let windDown = 0;

    /** Move up to `excess / effectiveness` MW against a constraint with sensitivity `sens`. */
    const relieve = (sens: (bus: number) => number, excess: number): boolean => {
      let down: { kind: 'wind' | 'unit'; i: number; sens: number; room: number } | null = null;
      m.wind.forEach((w, i) => {
        if (windMW[i]! < 1 || !sched.energised[w.bus]) return;
        const sv = sens(w.bus);
        if (sv > 0.03 && (!down || sv > down.sens + 1e-6)) down = { kind: 'wind', i, sens: sv, room: windMW[i]! };
      });
      for (const u of m.units) {
        const mw = unitMW[u.idx]!;
        if (mw - u.min < 1 || !sched.energised[u.bus]) continue;
        const sv = sens(u.bus);
        const cur = down as { sens: number } | null;
        if (sv > 0.03 && (!cur || sv > cur.sens + 0.02)) down = { kind: 'unit', i: u.idx, sens: sv, room: mw - u.min };
      }
      const d = down as { kind: 'wind' | 'unit'; i: number; sens: number; room: number } | null;
      if (!d) return false;
      // Raise the unit that unloads the constraint most relative to the one turned down; among
      // near-equal sensitivities, the cheapest.
      let up: { i: number; sens: number; room: number; cost: number } | null = null;
      for (const u of m.units) {
        if (!available(u.idx) || !sched.energised[u.bus] || u.capacity - unitMW[u.idx]! < 1) continue;
        const sv = sens(u.bus);
        if (sv > d.sens - 0.05) continue;
        if (!up || sv < up.sens - 0.02 || (Math.abs(sv - up.sens) <= 0.02 && u.spec.cost < up.cost))
          up = { i: u.idx, sens: sv, room: u.capacity - unitMW[u.idx]!, cost: u.spec.cost };
      }
      if (!up) return false;
      const eff = d.sens - up.sens;
      const mw = Math.min(d.room, up.room, (excess + 1) / eff, SCHED_MAX_MW - moved);
      if (mw < 0.5) return false;
      const downBus = d.kind === 'wind' ? m.wind[d.i]!.bus : m.units[d.i]!.bus;
      inj[downBus] = inj[downBus]! - mw;
      if (d.kind === 'wind') {
        windMW[d.i] = windMW[d.i]! - mw;
        windDown += mw;
      } else unitMW[d.i] = unitMW[d.i]! - mw;
      const upUnit = m.units[up.i]!;
      unitMW[up.i] = unitMW[up.i]! + mw;
      inj[upUnit.bus] = inj[upUnit.bus]! + mw;
      moved += mw;
      return true;
    };

    // 1. Intact network.
    const skip = new Set<number>();
    for (let iter = 0; iter < 24 && moved < SCHED_MAX_MW; iter++) {
      sched.flows(inj, flows);
      let l = -1;
      let worst = SCHED_LIMIT + 0.005;
      for (let k = 0; k < nb; k++) {
        if (!sched.active[k] || skip.has(k)) continue;
        const ld = Math.abs(flows[k]!) / ratings[k]!;
        if (ld > worst) {
          worst = ld;
          l = k;
        }
      }
      if (l < 0) break;
      const dir = Math.sign(flows[l]!) || 1;
      if (!relieve((bus) => dir * ptdf(sched, m.branches, l, bus), Math.abs(flows[l]!) - SCHED_LIMIT * ratings[l]!)) skip.add(l);
    }

    // 2. Preventive N-1 against the short-term emergency limit.
    sched.flows(inj, flows);
    const pairs: { l: number; k: number; over: number }[] = [];
    for (let k = 0; k < nb; k++) {
      if (!sched.active[k]) continue;
      const alpha = this.alpha[k]!;
      if (alpha === 1 && sched.islanding[k]) continue;
      const fk = flows[k]!;
      if (Math.abs(fk) < 0.5) continue;
      const sk = sched.transfer[k * nb + k]!;
      const scale = (alpha * fk) / (1 - alpha * sk);
      for (let l = 0; l < nb; l++) {
        if (!sched.active[l] || (l === k && alpha === 1)) continue;
        const post = l === k ? fk / (1 - alpha * sk) : flows[l]! + sched.transfer[l * nb + k]! * scale;
        const over = Math.abs(post) / ratings[l]!;
        if (over > SCHED_N1_LIMIT + 0.01) pairs.push({ l, k, over });
      }
    }
    pairs.sort((a, b) => b.over - a.over);
    const done = new Set<number>();
    for (const { l, k } of pairs.slice(0, 40)) {
      if (done.has(l) || moved >= SCHED_MAX_MW) continue;
      done.add(l);
      for (let iter = 0; iter < 4; iter++) {
        sched.flows(inj, flows);
        const alpha = this.alpha[k]!;
        const sk = sched.transfer[k * nb + k]!;
        const c = l === k ? 1 / (1 - alpha * sk) : (sched.transfer[l * nb + k]! * alpha) / (1 - alpha * sk);
        const post = l === k ? flows[k]! * c : flows[l]! + c * flows[k]!;
        const excess = Math.abs(post) - SCHED_N1_LIMIT * ratings[l]!;
        if (excess <= 0) break;
        const dir = Math.sign(post) || 1;
        const sens = (bus: number) =>
          dir * (l === k ? c * ptdf(sched, m.branches, k, bus) : ptdf(sched, m.branches, l, bus) + c * ptdf(sched, m.branches, k, bus));
        if (!relieve(sens, excess)) break;
      }
    }
    return { moved, windDown };
  }

  runDay(inp: EngineInputs): DayResult {
    const m = this.model;
    const nb = m.branches.length;
    const nBus = m.buses.length;
    const nU = m.units.length;
    const nW = m.wind.length;
    let solver = this.solverFor(inp.outages);
    const g = growth(inp.year);
    const type = dayType(inp.date.y, inp.date.m, inp.date.d);

    const res: DayResult = {
      nBranches: nb,
      flows: new Float32Array(STEPS * nb),
      loading: new Float32Array(STEPS * nb),
      n1Loading: new Float32Array(STEPS * nb),
      n1Cause: new Int16Array(STEPS * nb).fill(-1),
      ratings: new Float32Array(nb),
      series: Object.fromEntries(SERIES.map((k) => [k, new Float32Array(STEPS)])) as Record<SeriesKey, Float32Array>,
      unitMW: new Float32Array(STEPS * nU),
      injections: new Float32Array(STEPS * nBus),
      busLoad: new Float32Array(STEPS * nBus),
      windMW: new Float32Array(STEPS * nW),
      windSpeed: new Float32Array(STEPS * nW),
      islanding: solver.islanding,
      energised: solver.energised,
    };
    m.branches.forEach((b, i) => {
      res.ratings[i] = seasonRating(inp.date.m, b.winterMVA, b.summerMVA);
    });

    const roiNonDcPeak = demand.roiWinterPeak.value - dcAverageMW2025 * demand.dcGrowth2026.value;
    const niPeak = demand.niWinterPeak.value;
    const losses = 1 + demand.transmissionLosses.value;
    const unitDown = new Set(inp.unitOutages);
    const ics = m.interconnectors.filter((ic) => inp.year >= ic.spec.from);
    const centre = { lat: 53.4, lon: -7.9 };

    // ---- first pass: demand and renewables, so the battery can be scheduled across the day
    const plan = Array.from({ length: STEPS }, (_, s) => {
      const h = s * STEP_H;
      const roiNonDc = nonDcShape(h, inp.date.m, inp.date.d, type) * roiNonDcPeak * g.nonDc;
      const niLoad = nonDcShape(h, inp.date.m, inp.date.d, type) * niPeak * g.nonDc;
      const dc = g.dcMW * dcShape(h, demand.dcLoadFactor.value);
      const extra = Object.values(inp.extraLoad).reduce((a, b) => a + b, 0);
      const total = (roiNonDc + niLoad + dc + extra) * losses;
      const sp = sunPosition(irishLocalToUtc(inp.date.y, inp.date.m, inp.date.d, h), centre.lat, centre.lon);
      const solarCf = Math.max(0, Math.sin((sp.elevation * Math.PI) / 180)) ** 1.15 * 0.62;
      let windAvail = 0;
      const clusterAvail = new Float64Array(nW);
      m.wind.forEach((c, i) => {
        const v = siteSpeed(inp.wind, c.e, c.n, h, c.bus);
        res.windSpeed[s * nW + i] = v;
        const capMW = (c.country === 'ROI' ? g.windRoi : g.windNi) * c.share;
        const mw = capMW * powerCurve(v) * renewables.windAvailability.value;
        clusterAvail[i] = mw;
        windAvail += mw;
      });
      const solar = g.solar * solarCf;
      return { h, roiNonDc, niLoad, dc, extra, total, solar, windAvail, clusterAvail };
    });

    // Battery: discharge over the four highest net-demand hours, charge over the four lowest.
    const batMW = g.battery;
    const batMWh = batMW * storage.batteryHours.value;
    const net = plan.map((p, s) => ({ s, v: p.total - p.windAvail - p.solar }));
    const sorted = [...net].sort((a, b) => a.v - b.v || a.s - b.s);
    const batteryPlan = new Float64Array(STEPS);
    const perStep = batMWh / 4; // energy spread over 4 hours => power per step in MW
    sorted.slice(0, 16).forEach(({ s }) => (batteryPlan[s] = -Math.min(batMW, perStep)));
    sorted.slice(-16).forEach(({ s }) => (batteryPlan[s] = Math.min(batMW, perStep)));

    const inj = new Float64Array(nBus);
    const flows = new Float64Array(nb);
    const icImport = ics.reduce((sum, ic) => sum + inp.icShare * ic.spec.capacity.value, 0);

    for (let s = 0; s < STEPS; s++) {
      const p = plan[s]!;
      solver = this.solverFor(this.outagesAt(inp, s));
      const d = dispatch(m, {
        demandMW: p.total,
        windAvailMW: p.windAvail,
        solarAvailMW: p.solar,
        icImportMW: icImport,
        batteryMW: batteryPlan[s]!,
        unitAvailable: (u) => !unitDown.has(u) && solver.energised[m.units[u]!.bus] === 1,
      });
      const fWind = p.windAvail > 0 ? d.windMW / p.windAvail : 0;
      const fSolar = p.solar > 0 ? d.solarMW / p.solar : 0;

      inj.fill(0);
      // Loads
      for (let b = 0; b < nBus; b++) {
        const bus = m.buses[b]!;
        const w = m.demandWeight[b]!;
        if (!w) continue;
        const load = (bus.country === 'ROI' ? p.roiNonDc : p.niLoad) * w * losses;
        inj[b] = inj[b]! - load;
      }
      for (const ll of m.largeLoads) {
        const mw = (ll.share * p.dc + ll.mw) * losses;
        inj[ll.bus] = inj[ll.bus]! - mw;
      }
      for (const [bus, mw] of Object.entries(inp.extraLoad)) inj[Number(bus)] = inj[Number(bus)]! - mw * losses;
      for (let b = 0; b < nBus; b++) res.busLoad[s * nBus + b] = -inj[b]!;
      // Generation
      m.units.forEach((u) => (inj[u.bus] = inj[u.bus]! + d.unitMW[u.idx]!));
      m.wind.forEach((c, i) => {
        const mw = p.clusterAvail[i]! * fWind;
        res.windMW[s * nW + i] = mw;
        inj[c.bus] = inj[c.bus]! + mw;
      });
      m.solar.forEach((site) => (inj[site.bus] = inj[site.bus]! + site.share * p.solar * fSolar));
      m.batteries.forEach((bt) => (inj[bt.bus] = inj[bt.bus]! + bt.share * batteryPlan[s]!));
      for (const ic of ics) inj[ic.bus] = inj[ic.bus]! + inp.icShare * ic.spec.capacity.value;
      const constrained =
        inp.scheduleConstraints === false
          ? { moved: 0, windDown: 0 }
          : this.constrain(inj, d.unitMW, res.windMW.subarray(s * nW, (s + 1) * nW), res.ratings, inp.outages, (u) => !unitDown.has(u));
      solver = this.solverFor(this.outagesAt(inp, s));
      // Approved actions (re-dispatch, battery discharge, demand flexibility).
      let windCut = 0;
      for (const a of inp.adjustments ?? []) {
        if (s < a.fromStep) continue;
        inj[a.bus] = inj[a.bus]! + a.deltaMW;
        if (a.windCluster !== undefined && a.deltaMW < 0) {
          windCut += -a.deltaMW;
          res.windMW[s * nW + a.windCluster] = Math.max(0, res.windMW[s * nW + a.windCluster]! + a.deltaMW);
        }
      }

      // De-energised buses (islanded by outages) lose their load and generation.
      let islanded = 0;
      for (let b = 0; b < nBus; b++) {
        if (!solver.energised[b]) {
          islanded += Math.max(0, -inj[b]!);
          inj[b] = 0;
        }
        res.injections[s * nBus + b] = inj[b]!;
      }

      solver.flows(inj, flows);
      const off = s * nb;
      for (let l = 0; l < nb; l++) {
        res.flows[off + l] = flows[l]!;
        res.loading[off + l] = Math.abs(flows[l]!) / res.ratings[l]!;
      }
      // N-1 sweep: loss of one circuit (or one transformer unit) at a time. Removing a share
      // alpha of branch k's admittance changes flow on l by T[l,k] * alpha * f_k / (1 - alpha * s_k)
      // (alpha = 1 is the classic line outage distribution factor).
      for (let k = 0; k < nb; k++) {
        if (!solver.active[k]) continue;
        const alpha = this.alpha[k]!;
        const sk = solver.transfer[k * nb + k]!;
        if (alpha === 1 && solver.islanding[k]) continue;
        const fk = flows[k]!;
        if (Math.abs(fk) < 0.5) continue;
        const scale = (alpha * fk) / (1 - alpha * sk);
        for (let l = 0; l < nb; l++) {
          if (!solver.active[l]) continue;
          let post: number;
          if (l === k) {
            if (alpha === 1) continue;
            // remaining circuits of k carry f_k / (1 - alpha s_k) against (1 - alpha) of the rating
            post = Math.abs(fk / (1 - alpha * sk)) / res.ratings[l]!;
          } else {
            post = Math.abs(flows[l]! + solver.transfer[l * nb + k]! * scale) / res.ratings[l]!;
          }
          if (post > res.n1Loading[off + l]!) {
            res.n1Loading[off + l] = post;
            res.n1Cause[off + l] = k;
          }
        }
      }
      for (let l = 0; l < nb; l++) {
        if (res.n1Loading[off + l]! < res.loading[off + l]!) res.n1Loading[off + l] = res.loading[off + l]!;
      }

      for (let u = 0; u < nU; u++) res.unitMW[s * nU + u] = d.unitMW[u]!;
      const roiDemand = (p.roiNonDc + p.dc + p.extra) * losses;
      const se = res.series;
      se.demand[s] = p.total;
      se.roiDemand[s] = roiDemand;
      se.niDemand[s] = p.niLoad * losses;
      se.dc[s] = p.dc;
      se.windAvail[s] = p.windAvail;
      se.wind[s] = d.windMW - windCut - constrained.windDown;
      se.solar[s] = d.solarMW;
      se.curtailed[s] = d.curtailedMW + windCut;
      se.constrained[s] = constrained.moved;
      se.imports[s] = icImport;
      se.thermal[s] = d.unitMW.reduce((a, b) => a + b, 0);
      se.battery[s] = batteryPlan[s]!;
      se.snsp[s] = d.snsp;
      se.dcShare[s] = p.dc / ((p.roiNonDc + p.dc + p.extra) || 1);
      se.unserved[s] = d.unserved;
      se.islandedMW[s] = islanded;
    }
    return res;
  }
}
