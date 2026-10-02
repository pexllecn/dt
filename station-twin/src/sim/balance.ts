/**
 * Energisation by topology and the nodal power balance, ported from the prototype's solve().
 *
 * Pure: computeFlows() reads the registry and returns flows without mutating anything, so the
 * contingency screen and the coordinator's look-ahead can call it freely. applyFlows() writes
 * the result back onto the components (live, mwNow, dir, loadPU) as the prototype did.
 *
 * The parity preset has one 220 kV busbar and the border tie directly on it, exactly as the
 * prototype. The engineering preset has two 220 kV sections joined by a bus-section breaker and
 * the border tie fed through T4 at 275 kV. With the bus-section breaker closed and no fault, both
 * presets give identical flows.
 */
import { sgn } from '../lib/math.ts';
import type { Component, ComponentId, Dir, Part, Preset, Registry, Results, Section, Sys, TransformerId } from './types.ts';

export interface Topology {
  sectioned: boolean;
  borderViaT4: boolean;
}

export const topologyFor = (preset: Preset): Topology =>
  preset === 'parity' ? { sectioned: false, borderViaT4: false } : { sectioned: true, borderViaT4: true };

export interface FlowResult {
  live: Record<ComponentId, boolean>;
  mw: Record<ComponentId, number>;
  dir: Record<ComponentId, Dir>;
  loadPU: Record<TransformerId, number>;
  sectionLive: Record<Section, boolean>;
  b110: boolean;
  /** Battery power actually exchanged (+ discharge) and whether the battery is connected. */
  battery: { power: number; on: boolean };
  results: Results;
}

/** In service: built, breaker closed, not locked out, isolators closed. */
export function inService(c: Component): boolean {
  if (!c.installed || !c.closed || c.tripped) return false;
  return c.bay ? c.bay.dsBus && c.bay.dsLine : true;
}

const PARITY_LABELS: Record<string, string> = {
  grid_import: 'Grid import', wind: 'Wind', solar: 'Solar', battery_dis: 'Battery', gas: 'Gas', nbr_in: 'Neighbour in',
  regional: 'Town', new_conn: 'New estate', industrial: 'Industry', border: 'NI estate', battery_chg: 'Battery charge',
  grid_export: 'Grid export', nbr_out: 'Neighbour out',
};
const ENGINEERING_LABELS: Record<string, string> = {
  grid_import: '400 kV import', wind: 'Wind', solar: 'Solar', battery_dis: 'Battery', gas: 'Gas', nbr_in: 'Transfers in',
  regional: 'Regional demand', new_conn: 'New connection', industrial: 'Industrial park', border: 'Northern Ireland transfer',
  battery_chg: 'Battery charging', grid_export: '400 kV export', nbr_out: 'Transfers out',
};

export function computeFlows(C: Registry, sys: Sys, preset: Preset, outages: readonly ComponentId[] = []): FlowResult {
  const topo = topologyFor(preset);
  const eng = preset === 'engineering';
  const svc = (id: ComponentId) => !outages.includes(id) && inService(C[id]);

  // --- energisation ---------------------------------------------------------------
  const b400 = svc('GRID') && sys.gridHealthy;
  const t1 = b400 && svc('T1');
  const t2 = b400 && svc('T2');
  const faultA = sys.busFault.includes('A');
  const faultB = sys.busFault.includes('B');
  const bs = topo.sectioned ? svc('BS220') : true;
  const liveA = !faultA && (t1 || (bs && t2 && !faultB));
  const liveB = !faultB && (t2 || (bs && t1 && !faultA));
  const secLive = (s: Section | null) => (s === 'B' ? liveB : liveA);
  const b220 = liveA || liveB;
  const t3 = liveB && svc('T3');
  const b110 = t3;
  const t4 = topo.borderViaT4 ? liveB && svc('T4') : false;
  const borderLive = topo.borderViaT4 ? t4 && sys.coupled : b220 && sys.coupled;

  const live = {} as Record<ComponentId, boolean>;
  live.GRID = b400; live.BUS400 = b400; live.T1 = t1; live.T2 = t2;
  live.BUS220A = liveA; live.BUS220B = liveB; live.BS220 = topo.sectioned ? liveA || liveB : b220;
  live.T3 = t3; live.BUS110 = b110; live.T4 = t4;
  for (const id of ['WIND', 'SOLAR', 'GAS', 'BESS', 'LD_NEW', 'TIE_N'] as const) live[id] = secLive(C[id].section);
  live.LD_TOWN = b220;
  live.TIE_NI = borderLive;
  live.LD_IND = b110; live.TIE_S = b110;

  // --- injections and withdrawals ---------------------------------------------------
  const genOut = (id: 'WIND' | 'SOLAR' | 'GAS') => {
    const g = C[id];
    if (!secLive(g.section) || !svc(id)) return 0;
    return eng ? g.actual : Math.min(g.out, g.avail);
  };
  const wind = genOut('WIND');
  const solar = genOut('SOLAR');
  const gas = genOut('GAS');

  const B = C.BESS;
  const bessOn = svc('BESS') && secLive(B.section);
  let bset = 0;
  if (bessOn) {
    if (eng) bset = B.actual;
    else {
      bset = B.set;
      if (bset > 0 && B.soc <= 1) bset = 0; // empty: cannot discharge
      if (bset < 0 && B.soc >= 99) bset = 0; // full: cannot charge
    }
  }
  const bDis = Math.max(0, bset);
  const bChg = Math.max(0, -bset);

  const loadMw = (id: 'LD_TOWN' | 'LD_NEW' | 'LD_IND') => (eng ? C[id].actual : C[id].mw);
  const townBase = svc('LD_TOWN') ? Math.max(0, loadMw('LD_TOWN') - sys.shedMW) : 0;
  const townA = liveA ? townBase * 0.5 : 0;
  const townB = liveB ? townBase * 0.5 : 0;
  const town = townA + townB;
  const nwe = secLive(C.LD_NEW.section) && svc('LD_NEW') ? loadMw('LD_NEW') : 0;
  const ind = b110 && svc('LD_IND') ? loadMw('LD_IND') : 0;
  const ni = borderLive && svc('TIE_NI') ? (eng ? C.TIE_NI.actual : C.TIE_NI.mw) : 0;
  const nbrN = secLive(C.TIE_N.section) && svc('TIE_N') ? (eng ? C.TIE_N.actual : C.TIE_N.set) : 0;
  const nbrS = b110 && svc('TIE_S') ? (eng ? C.TIE_S.actual : C.TIE_S.set) : 0;

  // 110 kV: what must come down through T3. 275 kV: what goes out through T4.
  const t3Flow = ind - nbrS;
  const t4Flow = topo.borderViaT4 ? ni : 0;

  // 220 kV: net withdrawal per section (+ = needs power from its 400/220 kV unit).
  const onA = (id: ComponentId) => C[id].section === 'A';
  const sum = (ids: ComponentId[], v: (id: ComponentId) => number) => ids.reduce((a, id) => a + v(id), 0);
  const genOf = (id: ComponentId) => (id === 'WIND' ? wind : id === 'SOLAR' ? solar : id === 'GAS' ? gas : 0);
  const gens: ComponentId[] = ['WIND', 'SOLAR', 'GAS'];
  const wA = townA + (onA('LD_NEW') ? nwe : 0) + (onA('BESS') ? bChg - bDis : 0) - sum(gens.filter(onA), genOf) - (onA('TIE_N') ? nbrN : 0);
  const wB = townB + (!onA('LD_NEW') ? nwe : 0) + (!onA('BESS') ? bChg - bDis : 0) - sum(gens.filter((g) => !onA(g)), genOf)
    - (!onA('TIE_N') ? nbrN : 0) + t3Flow + (topo.borderViaT4 ? t4Flow : ni);

  // The station's net draw from the 400 kV system. Written in the prototype's order so the
  // parity preset is bit-for-bit identical when the busbar is not split.
  const merged = !topo.sectioned || (bs && liveA && liveB);
  let f1 = 0;
  let f2 = 0;
  let gridFlow: number;
  if (merged) {
    gridFlow = (town + nwe + ni + t3Flow + bChg) - (wind + solar + gas + bDis + nbrN);
    const nTx = (t1 ? 1 : 0) + (t2 ? 1 : 0);
    // Identical units with equal impedance and taps share equally.
    if (nTx) { f1 = t1 ? gridFlow / nTx : 0; f2 = t2 ? gridFlow / nTx : 0; }
  } else {
    f1 = liveA && t1 ? wA : 0;
    f2 = liveB && t2 ? wB : 0;
    gridFlow = f1 + f2;
  }
  const bsFlow = merged && topo.sectioned ? f1 - wA : 0;

  // --- per-component MW and direction ----------------------------------------------
  const mw = {} as Record<ComponentId, number>;
  const dir = {} as Record<ComponentId, Dir>;
  for (const id of Object.keys(C) as ComponentId[]) { mw[id] = 0; dir[id] = 0; }
  mw.WIND = wind; dir.WIND = wind > 0 ? 1 : 0;
  mw.SOLAR = solar; dir.SOLAR = solar > 0 ? 1 : 0;
  mw.GAS = gas; dir.GAS = gas > 0 ? 1 : 0;
  mw.BESS = bset; dir.BESS = sgn(bset);
  mw.LD_TOWN = town; dir.LD_TOWN = town > 0 ? -1 : 0;
  mw.LD_NEW = nwe; dir.LD_NEW = nwe > 0 ? -1 : 0;
  mw.LD_IND = ind; dir.LD_IND = ind > 0 ? -1 : 0;
  mw.TIE_NI = ni; dir.TIE_NI = ni > 0 ? -1 : 0;
  mw.TIE_N = nbrN; dir.TIE_N = sgn(nbrN);
  mw.TIE_S = nbrS; dir.TIE_S = sgn(nbrS);
  mw.T3 = Math.abs(t3Flow); dir.T3 = sgn(t3Flow);
  mw.T4 = Math.abs(t4Flow); dir.T4 = t4 ? sgn(t4Flow) : 0;
  mw.GRID = Math.abs(gridFlow); dir.GRID = sgn(gridFlow);
  mw.BUS400 = Math.abs(gridFlow);
  mw.BUS110 = Math.abs(t3Flow);
  mw.BS220 = Math.abs(bsFlow); dir.BS220 = sgn(bsFlow);
  // Busbar throughput: the sum of everything flowing into the section.
  const intoA = Math.max(0, f1) + (onA('BESS') ? bDis : 0) + sum(gens.filter(onA), genOf) + (onA('TIE_N') ? Math.max(0, nbrN) : 0) + Math.max(0, -bsFlow);
  const intoB = Math.max(0, f2) + (!onA('BESS') ? bDis : 0) + sum(gens.filter((g) => !onA(g)), genOf) + Math.max(0, bsFlow) + Math.max(0, -t3Flow);
  mw.BUS220A = topo.sectioned ? intoA : Math.abs(gridFlow);
  mw.BUS220B = topo.sectioned ? intoB : Math.abs(gridFlow);

  const loadPU = {} as Record<TransformerId, number>;
  if (merged) {
    const nTx = (t1 ? 1 : 0) + (t2 ? 1 : 0);
    mw.T1 = t1 && nTx ? Math.abs(gridFlow) / nTx : 0;
    mw.T2 = t2 && nTx ? Math.abs(gridFlow) / nTx : 0;
    dir.T1 = t1 ? sgn(gridFlow) : 0;
    dir.T2 = t2 ? sgn(gridFlow) : 0;
  } else {
    mw.T1 = Math.abs(f1); mw.T2 = Math.abs(f2);
    dir.T1 = t1 ? sgn(f1) : 0; dir.T2 = t2 ? sgn(f2) : 0;
  }
  loadPU.T1 = mw.T1 / C.T1.cap;
  loadPU.T2 = mw.T2 / C.T2.cap;
  loadPU.T3 = t3 ? mw.T3 / C.T3.cap : 0;
  loadPU.T4 = t4 ? mw.T4 / C.T4.cap : 0;

  // --- supply and demand breakdown ------------------------------------------------
  const labels = eng ? ENGINEERING_LABELS : PARITY_LABELS;
  const sup: Part[] = [];
  const dem: Part[] = [];
  const add = (arr: Part[], key: string, v: number) => { if (v > 0.5) arr.push({ key, label: labels[key] ?? key, mw: v }); };
  add(sup, 'grid_import', Math.max(0, gridFlow));
  add(sup, 'wind', wind);
  add(sup, 'solar', solar);
  add(sup, 'battery_dis', bDis);
  add(sup, 'gas', gas);
  add(sup, 'nbr_in', Math.max(0, nbrN) + Math.max(0, nbrS));
  add(dem, 'regional', town);
  add(dem, 'new_conn', nwe);
  add(dem, 'industrial', ind);
  add(dem, 'border', ni);
  add(dem, 'battery_chg', bChg);
  add(dem, 'grid_export', Math.max(0, -gridFlow));
  add(dem, 'nbr_out', Math.max(0, -nbrN) + Math.max(0, -nbrS));
  const supply = sup.reduce((a, b) => a + b.mw, 0);
  const demand = dem.reduce((a, b) => a + b.mw, 0);

  let unbal = 0;
  if (gridFlow > C.GRID.cap) unbal = gridFlow - C.GRID.cap;
  if (gridFlow < -700) unbal = gridFlow + 700;
  if (!b220) unbal = 0;

  // --- residuals: each node must balance -------------------------------------------
  const residuals = {
    B400: b400 ? gridFlow - (f1 + f2) : 0,
    B220A: f1 + (onA('BESS') ? bDis - bChg : 0) + sum(gens.filter(onA), genOf) + (onA('TIE_N') ? nbrN : 0) - townA - (onA('LD_NEW') ? nwe : 0) - bsFlow,
    B220B: f2 + bsFlow + (!onA('BESS') ? bDis - bChg : 0) + sum(gens.filter((g) => !onA(g)), genOf) + (!onA('TIE_N') ? nbrN : 0)
      - townB - (!onA('LD_NEW') ? nwe : 0) - t3Flow - (topo.borderViaT4 ? t4Flow : ni),
    B110: t3Flow + nbrS - ind,
    B275: t4Flow - (topo.borderViaT4 ? ni : 0),
  };
  if (!topo.sectioned) {
    // One busbar: report the combined residual on A and nothing on B.
    residuals.B220A = residuals.B220A + residuals.B220B;
    residuals.B220B = 0;
  }

  const localGeneration = wind + solar + gas + bDis;
  const localDemand = town + nwe + ind + bChg;
  const regionalSetpoint = svc('LD_TOWN') ? Math.max(0, loadMw('LD_TOWN') - sys.shedMW) : 0;

  return {
    live, mw, dir, loadPU, sectionLive: { A: liveA, B: liveB }, b110,
    battery: { power: bset, on: bessOn },
    results: {
      gridFlow, t3Flow, t4Flow, supply, demand,
      renewPct: supply > 0 ? ((wind + solar) / supply) * 100 : 0,
      unbal, parts: { sup, dem },
      txFlow: { T1: f1, T2: f2, T3: t3 ? t3Flow : 0, T4: t4 ? t4Flow : 0 },
      bsFlow, localGeneration, localDemand, residuals,
      regional: { A: townA, B: townB, offSupply: Math.max(0, regionalSetpoint - town) },
    },
  };
}

export function applyFlows(C: Registry, f: FlowResult): void {
  for (const id of Object.keys(C) as ComponentId[]) {
    const c = C[id];
    c.live = f.live[id];
    c.mwNow = f.mw[id];
    c.dir = f.dir[id];
  }
  C.T1.loadPU = f.loadPU.T1;
  C.T2.loadPU = f.loadPU.T2;
  C.T3.loadPU = f.loadPU.T3;
  C.T4.loadPU = f.loadPU.T4;
}
