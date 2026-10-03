import { ptdf, type DCSolver } from './powerflow';
import type { DayResult, Engine, EngineInputs } from './engine';
import { scenarios } from './scenarios';

/**
 * Connection studies for a new demand at one bus (METHOD-FIRM-01).
 *
 * For each 15-minute interval of a studied day, firm capacity is the largest new demand at the
 * bus for which every circuit stays within its rating with everything in service and after any
 * single outage. New demand is balanced at the reference bus, so its effect on each circuit is
 * the PTDF, and after the loss of circuit k it is PTDF_l + c_lk PTDF_k (the outage distribution
 * factor for the lost share of k). Only circuits the new demand affects by at least 5% count
 * (the usual distribution factor cut-off): pre-existing issues elsewhere are not the connection's
 * to solve.
 */

export type StudyId = 'typical' | 'winter' | 'lowwind' | 'mainfeed';

export interface StudyResult {
  id: StudyId;
  title: string;
  /** Plain-English description of the case. */
  description: string;
  days: number;
  /** Firm MW per interval (96 per day), capped at the request. */
  firmMW: number[];
  /** Index into `constraints` of the binding constraint per interval (-1 if the request fits). */
  binding: number[];
  /** Days per year this case stands for in the annual estimate (0: not part of it). */
  weight: number;
}

export interface Constraint {
  label: string;
  branch: string;
  contingency: string | null;
}

export interface StudyBundle {
  bus: string;
  busLabel: string;
  /** The MW requested by the customer. */
  requestedMW: number;
  /** Study range: firm capacity is evaluated up to this level. */
  requestMW: number;
  /** The circuit carrying most of the new demand, taken out for the maintenance study. */
  mainFeed: { id: string; label: string };
  studies: StudyResult[];
  constraints: Constraint[];
  /** Firm in every studied interval of the secure (N-1) studies. */
  firmAllMW: number;
  /** Most frequent binding constraint across the N-1 studies. */
  topConstraint: number;
  /** Indicative firm level if that constraint is relieved (next constraint binds). */
  firmIfRelievedMW: number;
  /** Constraints already violated before the connection (not attributed to it). */
  preExisting: string[];
  /** Circuits carrying at least 5% of the new demand with everything in service. */
  affected: { id: string; label: string; share: number }[];
  method: string;
  limits: { intact: number; postFault: number };
  ms: number;
}

const INTACT_LIMIT = 1.0;
/** Post-fault limit, the same short-term emergency rating the scheduler uses (Assumption). */
const POST_FAULT_LIMIT = 1.2;
/** Distribution factor below which a circuit is not counted as affected (5%, common TSO practice). */
const MIN_EFFECT = 0.05;

/** Largest X >= 0 with |f - X s| <= R (s = sensitivity of the circuit to +1 MW of new demand). */
function headroom(f: number, s: number, R: number): number {
  if (Math.abs(s) < MIN_EFFECT) return Infinity;
  // New demand changes the flow by -X * p, where p is the injection PTDF; s here is -p.
  const hi = s > 0 ? (R - f) / s : (f + R) / -s;
  return Math.max(0, hi);
}

interface IntervalResult {
  firm: number;
  binding: { l: number; k: number } | null;
}

/** A monitored circuit l (after losing k, or intact when k = -1) the new demand affects. */
interface Pair {
  l: number;
  k: number;
  /** Outage factor: post-fault flow on l = f_l + c f_k (l = k: c f_k). */
  c: number;
  /** Change in (post-fault) flow on l per MW of new demand. */
  effect: number;
}

/** Pairs depend only on topology and the bus, so they are computed once per solver. */
const pairCache = new WeakMap<DCSolver, Map<number, Pair[]>>();


function pairsFor(engine: Engine, solver: DCSolver, bus: number): Pair[] {
  let byBus = pairCache.get(solver);
  if (!byBus) pairCache.set(solver, (byBus = new Map()));
  const hit = byBus.get(bus);
  if (hit) return hit;
  const m = engine.model;
  const nb = m.branches.length;
  // New demand is met by the large synchronous units pro-rata to capacity (the marginal plant),
  // not by the single reference bus.
  const pool = m.units.filter((u) => u.spec.large && solver.energised[u.bus]);
  const poolCap = pool.reduce((a, u) => a + u.capacity, 0) || 1;
  // A circuit counts only when the demand side of the effect (relative to the reference bus)
  // passes the cut-off, so the pool generators' own export circuits are not attributed to it.
  const sens = new Float64Array(nb);
  const local = new Float64Array(nb);
  for (let l = 0; l < nb; l++) {
    if (!solver.active[l]) continue;
    let supply = 0;
    for (const u of pool) supply += (u.capacity / poolCap) * ptdf(solver, m.branches, l, u.bus);
    local[l] = -ptdf(solver, m.branches, l, bus);
    sens[l] = supply + local[l]!;
  }
  const pairs: Pair[] = [];
  for (let l = 0; l < nb; l++) if (solver.active[l] && Math.abs(local[l]!) >= MIN_EFFECT && Math.abs(sens[l]!) >= MIN_EFFECT) pairs.push({ l, k: -1, c: 0, effect: sens[l]! });
  for (let k = 0; k < nb; k++) {
    if (!solver.active[k]) continue;
    const alpha = engine.alpha[k]!;
    if (alpha === 1 && solver.islanding[k]) continue;
    const sk = solver.transfer[k * nb + k]!;
    for (let l = 0; l < nb; l++) {
      if (!solver.active[l] || (l === k && alpha === 1)) continue;
      const c = l === k ? 1 / (1 - alpha * sk) : (solver.transfer[l * nb + k]! * alpha) / (1 - alpha * sk);
      const effect = l === k ? c * sens[k]! : sens[l]! + c * sens[k]!;
      const own = l === k ? c * local[k]! : local[l]! + c * local[k]!;
      if (Math.abs(effect) >= MIN_EFFECT && Math.abs(own) >= MIN_EFFECT) pairs.push({ l, k, c, effect });
    }
  }
  byBus.set(bus, pairs);
  return pairs;
}

function intervalFirm(
  engine: Engine,
  solver: DCSolver,
  day: DayResult,
  s: number,
  bus: number,
  cap: number,
  skipBranch: number,
  preExisting?: Set<string>,
): IntervalResult {
  const nb = engine.model.branches.length;
  const off = s * nb;
  let firm = cap;
  let binding: IntervalResult['binding'] = null;
  for (const p of pairsFor(engine, solver, bus)) {
    if (p.l === skipBranch) continue;
    const fk = p.k < 0 ? 0 : day.flows[off + p.k]!;
    const f = p.k < 0 ? day.flows[off + p.l]! : p.l === p.k ? p.c * fk : day.flows[off + p.l]! + p.c * fk;
    const R = (p.k < 0 ? INTACT_LIMIT : POST_FAULT_LIMIT) * day.ratings[p.l]!;
    // Already above the limit before the connection: a pre-existing constraint, reported
    // separately and not attributed to this request.
    if (Math.abs(f) > R) {
      preExisting?.add(`${p.l}|${p.k}`);
      continue;
    }
    const x = headroom(f, p.effect, R);
    if (x < firm) {
      firm = x;
      binding = { l: p.l, k: p.k };
    }
  }
  return { firm: Math.max(0, firm), binding };
}

/**
 * Study a request at a bus. Firm capacity is evaluated up to `rangeMW` (at least the request), so
 * the firmness dial can show what a larger request would face.
 */
export function runConnectionStudies(engine: Engine, busId: string, request: number, rangeMW = request): StudyBundle {
  const requestMW = Math.max(request, rangeMW);
  const t0 = performance.now();
  const m = engine.model;
  const bus = m.busIndex.get(busId);
  if (bus === undefined) throw new Error(`bus not found: ${busId}`);
  const hero = scenarios.hero;

  // Main feed: the in-service circuit that would carry the largest share of the new demand.
  const intact = engine.solverFor([]);
  let feed = -1;
  let feedShare = 0;
  m.branches.forEach((b, l) => {
    if ((b.from !== bus && b.to !== bus) || !intact.active[l]) return;
    const share = Math.abs(ptdf(intact, m.branches, l, bus));
    if (share > feedShare) {
      feedShare = share;
      feed = l;
    }
  });

  const affected = m.branches
    .map((b, l) => ({ id: b.id, label: b.label, share: intact.active[l] ? Math.abs(ptdf(intact, m.branches, l, bus)) : 0 }))
    .filter((a) => a.share >= MIN_EFFECT)
    .sort((a, b) => b.share - a.share)
    .slice(0, 10)
    .map((a) => ({ ...a, share: Math.round(a.share * 100) / 100 }));

  const base = (over: Partial<EngineInputs>): EngineInputs => ({
    date: hero.date,
    year: hero.year,
    wind: { reference: hero.windRef, seed: hero.seed, scale: 1 },
    icShare: hero.icShare,
    extraLoad: {},
    outages: [],
    unitOutages: [],
    ...over,
  });
  const cases: { id: StudyId; title: string; description: string; inputs: EngineInputs[]; weight: number }[] = [
    { id: 'typical', title: 'Typical day', description: 'An autumn weekday as scheduled today, all circuits in service.', inputs: [base({})], weight: 250 },
    {
      id: 'winter',
      title: 'Winter peak',
      description: 'A January weekday at winter peak demand with light wind.',
      inputs: [base({ date: { y: 2026, m: 1, d: 14 }, wind: { reference: (h) => 6 + 1.2 * Math.sin(((h - 15) / 24) * 2 * Math.PI), seed: 3, scale: 1 } })],
      weight: 60,
    },
    {
      id: 'lowwind',
      title: 'Low-wind week',
      description: 'Seven February days of high pressure: little wind anywhere on the island.',
      inputs: Array.from({ length: 7 }, (_, d) =>
        base({ date: { y: 2026, m: 2, d: 2 + d }, wind: { reference: (h) => 3.6 + 0.8 * Math.sin(((h - 14 + d) / 24) * 2 * Math.PI), seed: 40 + d, scale: 1 } }),
      ),
      weight: 55,
    },
    {
      id: 'mainfeed',
      title: 'Main feed out',
      description: `A typical day with ${feed >= 0 ? m.branches[feed]!.label : 'the main feed'} out for maintenance, checked against a further single outage.`,
      inputs: [base({ outages: feed >= 0 ? [feed] : [] })],
      weight: 0,
    },
  ];

  const constraints: Constraint[] = [];
  const cIndex = new Map<string, number>();
  const constraintOf = (l: number, k: number) => {
    const key = `${l}|${k}`;
    let i = cIndex.get(key);
    if (i === undefined) {
      i = constraints.length;
      cIndex.set(key, i);
      constraints.push({
        label: k < 0 ? `${m.branches[l]!.label}, intact` : `${m.branches[l]!.label} after ${engine.contingencyLabel(k)}`,
        branch: m.branches[l]!.id,
        contingency: k < 0 ? null : m.branches[k]!.id,
      });
    }
    return i;
  };

  const studies: StudyResult[] = [];
  const days: { id: StudyId; inp: EngineInputs; day: DayResult }[] = [];
  const pre = new Set<string>();
  for (const c of cases) {
    const firmMW: number[] = [];
    const binding: number[] = [];
    for (const inp of c.inputs) {
      const day = engine.runDay(inp);
      days.push({ id: c.id, inp, day });
      for (let s = 0; s < 96; s++) {
        const solver = engine.solverFor(engine.outagesAt(inp, s));
        if (!solver.energised[bus]) {
          firmMW.push(0);
          binding.push(-1);
          continue;
        }
        const r = intervalFirm(engine, solver, day, s, bus, requestMW, -1, pre);
        firmMW.push(Math.round(r.firm * 10) / 10);
        binding.push(r.binding && r.firm < requestMW ? constraintOf(r.binding.l, r.binding.k) : -1);
      }
    }
    studies.push({ id: c.id, title: c.title, description: c.description, days: c.inputs.length, firmMW, binding, weight: c.weight });
  }

  const secure = studies.filter((s) => s.id !== 'mainfeed');
  const firmAllMW = Math.min(requestMW, ...secure.flatMap((s) => s.firmMW));
  const counts = new Map<number, number>();
  for (const s of secure) for (const b of s.binding) if (b >= 0) counts.set(b, (counts.get(b) ?? 0) + 1);
  // The constraint that sets the firm level (binding at the minimum), else the most frequent.
  let topConstraint = -1;
  for (const s of secure) {
    const i = s.firmMW.indexOf(firmAllMW);
    if (i >= 0 && s.binding[i]! >= 0) {
      topConstraint = s.binding[i]!;
      break;
    }
  }
  if (topConstraint < 0) topConstraint = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;

  // Indicative: relieve the top constraint (e.g. uprating) and find what binds next.
  let firmIfRelievedMW = requestMW;
  if (topConstraint >= 0) {
    const tc = constraints[topConstraint]!;
    const l = m.branches.findIndex((b) => b.id === tc.branch);
    // Relieving a circuit (for example by uprating) relieves it in every case.
    for (const { id, inp, day } of days) {
      if (id === 'mainfeed') continue;
      for (let s = 0; s < 96; s++) {
        const solver = engine.solverFor(engine.outagesAt(inp, s));
        if (!solver.energised[bus]) continue;
        firmIfRelievedMW = Math.min(firmIfRelievedMW, intervalFirm(engine, solver, day, s, bus, requestMW, l).firm);
      }
    }
  }
  engine.solverFor([]);

  return {
    bus: busId,
    busLabel: `${m.buses[bus]!.node.name} ${m.buses[bus]!.kv} kV`,
    requestedMW: request,
    requestMW,
    mainFeed: feed >= 0 ? { id: m.branches[feed]!.id, label: m.branches[feed]!.label } : { id: '', label: 'none' },
    studies,
    constraints,
    firmAllMW: Math.round(firmAllMW * 10) / 10,
    topConstraint,
    firmIfRelievedMW: Math.round(firmIfRelievedMW * 10) / 10,
    affected,
    preExisting: [...pre].map((key) => {
      const [l, k] = key.split('|').map(Number) as [number, number];
      return k < 0 ? `${m.branches[l]!.label}, intact` : `${m.branches[l]!.label} after ${engine.contingencyLabel(k)}`;
    }),
    method: 'METHOD-FIRM-01 (firm capacity per interval, DC model, PTDF and outage distribution factors, N-1)',
    limits: { intact: INTACT_LIMIT, postFault: POST_FAULT_LIMIT },
    ms: performance.now() - t0,
  };
}

/** Share of studied intervals (weighted to a year) in which a given level is firm, and curtailed energy. */
export function firmness(bundle: StudyBundle, levelMW: number): { share: number; curtailedMWhYear: number; worstStudy: string } {
  let served = 0;
  let total = 0;
  let curtailed = 0;
  let worst = '';
  let worstShare = 2;
  for (const st of bundle.studies) {
    if (!st.weight) continue;
    const perDay = st.weight / st.days;
    const w = perDay / 96;
    let ok = 0;
    for (const f of st.firmMW) {
      total += w;
      if (f + 1e-6 >= levelMW) {
        served += w;
        ok++;
      } else curtailed += (levelMW - f) * 0.25 * perDay;
    }
    const sh = ok / st.firmMW.length;
    if (sh < worstShare) {
      worstShare = sh;
      worst = st.title;
    }
  }
  return { share: total ? served / total : 1, curtailedMWhYear: curtailed, worstStudy: worst };
}
