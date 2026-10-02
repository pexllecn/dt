import { addedCables, baseMVA, branchOverrides, circuitClass, transformerClass } from '@/config/network';
import {
  dataCentreClusters,
  interconnectors,
  northWestLargeUser,
  renewables,
  storage,
  units,
  type InterconnectorSpec,
  type UnitSpec,
} from '@/config/system';
import type { NetBranch, NetNode, NetworkBundle } from './types';

export interface Bus {
  idx: number;
  id: string;
  node: NetNode;
  kv: number;
  country: 'ROI' | 'NI';
}

export interface Branch {
  idx: number;
  id: string;
  from: number;
  to: number;
  kind: 'line' | 'cable' | 'transformer';
  kv: number;
  kvLow?: number;
  lengthKm: number;
  circuits: number;
  /** Series reactance, per unit on the system base, all circuits in parallel. */
  x: number;
  winterMVA: number;
  summerMVA: number;
  /** Transformers only: rating and own-base reactance of one unit, and the unit count. */
  unit?: { ratingMVA: number; xPu: number; count: number };
  /** Plain-English label, e.g. "Flagford to Srananagh 220 kV". */
  label: string;
  osmName: string | null;
}

export interface Unit {
  idx: number;
  spec: UnitSpec;
  bus: number;
  capacity: number;
  min: number;
}

export interface Interconnector {
  spec: InterconnectorSpec;
  bus: number;
}

export interface WindCluster {
  bus: number;
  share: number; // of jurisdiction installed capacity
  country: 'ROI' | 'NI';
  e: number;
  n: number;
  name: string;
}

export interface SolarSite {
  bus: number;
  share: number;
}

export interface Battery {
  bus: number;
  name: string;
  share: number;
}

export interface LargeLoad {
  id: string;
  name: string;
  bus: number;
  share: number; // of national data centre demand; 0 for fixed MW loads
  mw: number; // fixed MW (hypothetical or user-added)
  hypothetical: boolean;
}

export interface Model {
  buses: Bus[];
  branches: Branch[];
  hvdcRoutes: NetBranch[];
  units: Unit[];
  interconnectors: Interconnector[];
  wind: WindCluster[];
  solar: SolarSite[];
  batteries: Battery[];
  largeLoads: LargeLoad[];
  /** Non-data-centre demand weight per bus (sums to 1 within each jurisdiction). */
  demandWeight: Float64Array;
  slack: number;
  busIndex: Map<string, number>;
  nodeById: Map<string, NetNode>;
}

function short(node: NetNode): string {
  if (node.kind === 'tee') return node.name.replace(/^Tee near /, 'tee near ').replace(/ \(\d+ km\)$/, '');
  return node.name;
}

/** Compile the network bundle and configuration into indexed arrays for the solver. */
/** Change the number of units at a transformer branch, keeping reactance and rating consistent. */
export function setTransformerUnits(b: Branch, count: number): void {
  if (!b.unit) return;
  b.unit.count = count;
  b.x = b.unit.xPu / count;
  b.winterMVA = b.unit.ratingMVA * count;
  b.summerMVA = b.unit.ratingMVA * count;
}

export function buildModel(bundle: NetworkBundle): Model {
  const { network, allocation, plants } = bundle;
  const nodeById = new Map(network.nodes.map((n) => [n.id, n]));
  const buses: Bus[] = network.buses.map((b, idx) => {
    const node = nodeById.get(b.node)!;
    return { idx, id: b.id, node, kv: b.kv, country: node.country };
  });
  const busIndex = new Map(buses.map((b) => [b.id, b.idx]));
  const base = baseMVA.value;

  const branches: Branch[] = [];
  const hvdcRoutes: NetBranch[] = [];
  const busAt = (station: string, kv: number) => {
    const node = network.nodes.find((n) => n.kind === 'station' && n.name === station);
    return node ? network.buses.find((b) => b.node === node.id && b.kv === kv)?.id : undefined;
  };
  const added: NetBranch[] = addedCables.flatMap((c) => {
    const from = busAt(c.from, c.kv);
    const to = busAt(c.to, c.kv);
    return from && to ? [{ id: c.id, from, to, kind: 'cable' as const, kv: c.kv, lengthKm: c.lengthKm, cableFraction: 1, circuits: c.circuits, name: c.note }] : [];
  });
  for (const br of [...network.branches, ...added]) {
    if (br.kind === 'hvdc') {
      hvdcRoutes.push(br);
      continue;
    }
    const from = busIndex.get(br.from);
    const to = busIndex.get(br.to);
    if (from === undefined || to === undefined) continue;
    const circuits = Math.max(1, br.circuits);
    let x: number;
    let winter: number;
    let summer: number;
    let unit: Branch['unit'];
    if (br.kind === 'transformer') {
      const tc = transformerClass(br.kv, br.kvLow ?? 110);
      const n = tc.units.value;
      x = (tc.xPuOwn.value * (base / tc.ratingMVA.value)) / n;
      winter = tc.ratingMVA.value * n;
      summer = tc.ratingMVA.value * n;
      unit = { ratingMVA: tc.ratingMVA.value, xPu: tc.xPuOwn.value * (base / tc.ratingMVA.value), count: n };
    } else {
      const cable = (br.cableFraction ?? 0) > 0.5;
      const cc = circuitClass(br.kv, cable);
      // Mixed routes: reactance by length share of each construction.
      const cf = br.cableFraction ?? 0;
      const xo = circuitClass(br.kv, false).xOhmPerKm.value;
      const xc = circuitClass(br.kv, true).xOhmPerKm.value;
      const ohms = Math.max(0.05, br.lengthKm) * (xo * (1 - cf) + xc * cf);
      const zBase = (br.kv * br.kv) / base;
      x = ohms / zBase / circuits;
      // The weaker construction sets the rating of a mixed route.
      const ovh = circuitClass(br.kv, false);
      const und = circuitClass(br.kv, true);
      const weakW = cf > 0.02 ? Math.min(ovh.winterMVA.value, und.winterMVA.value) : cc.winterMVA.value;
      const weakS = cf > 0.02 ? Math.min(ovh.summerMVA.value, und.summerMVA.value) : cc.summerMVA.value;
      winter = (cf > 0.98 ? und.winterMVA.value : weakW) * circuits;
      summer = (cf > 0.98 ? und.summerMVA.value : weakS) * circuits;
    }
    const a = buses[from]!.node;
    const z = buses[to]!.node;
    const label =
      br.kind === 'transformer'
        ? `${a.name} ${br.kv}/${br.kvLow} kV transformers`
        : `${short(a)} to ${short(z)} ${br.kv} kV`;
    branches.push({
      idx: branches.length,
      id: br.id,
      from,
      to,
      kind: br.kind,
      kv: br.kv,
      kvLow: br.kvLow,
      lengthKm: br.lengthKm,
      circuits,
      x: Math.max(x, 1e-5),
      winterMVA: winter,
      summerMVA: summer,
      unit,
      label,
      osmName: br.name,
    });
  }

  const findBus = (station: string, kv: number): number => {
    const want = station.toLowerCase();
    const node =
      network.nodes.find((n) => n.kind === 'station' && n.name.toLowerCase() === want) ??
      network.nodes.find((n) => n.kind === 'station' && n.name.toLowerCase().includes(want));
    if (!node) throw new Error(`station not found in network: ${station}`);
    const candidates = buses.filter((b) => b.node.id === node.id);
    if (!candidates.length) throw new Error(`station has no buses: ${station}`);
    return candidates.reduce((best, b) => (Math.abs(b.kv - kv) < Math.abs(best.kv - kv) ? b : best)).idx;
  };

  const modelUnits: Unit[] = units.map((spec, idx) => ({
    idx,
    spec,
    bus: findBus(spec.station, spec.kv),
    capacity: spec.capacity.value,
    min: spec.capacity.value * spec.minStable,
  }));

  const ics: Interconnector[] = interconnectors.map((spec) => ({ spec, bus: findBus(spec.station, spec.kv) }));

  // Wind: installed capacity per jurisdiction shared by OSM turbine counts near each 110 kV station.
  const wind: WindCluster[] = [];
  const totals: Record<'ROI' | 'NI', number> = { ROI: 0, NI: 0 };
  for (const [busId, count] of Object.entries(allocation.turbinesByBus)) {
    const idx = busIndex.get(busId);
    if (idx === undefined) continue;
    totals[buses[idx]!.country] += count;
  }
  for (const [busId, count] of Object.entries(allocation.turbinesByBus)) {
    const idx = busIndex.get(busId);
    if (idx === undefined) continue;
    const b = buses[idx]!;
    wind.push({ bus: idx, share: count / totals[b.country], country: b.country, e: b.node.e, n: b.node.n, name: b.node.name });
  }

  // Solar and batteries from OSM plants (by MW tag where present), shared within the configured totals.
  const share = (src: string, defaultMw: number) => {
    const list = plants.filter((p) => p.source === src && busIndex.has(p.bus));
    const total = list.reduce((s, p) => s + (p.mwTag ?? defaultMw), 0) || 1;
    return list.map((p) => ({ bus: busIndex.get(p.bus)!, name: p.name ?? 'Site', share: (p.mwTag ?? defaultMw) / total }));
  };
  const solar: SolarSite[] = share('solar', 5).map(({ bus, share: s }) => ({ bus, share: s }));
  const batteries: Battery[] = share('battery', 20);

  // Data centres and the hypothetical north west user.
  const largeLoads: LargeLoad[] = dataCentreClusters.map((c) => ({
    id: c.id,
    name: c.name,
    bus: findBus(c.station, c.kv),
    share: c.share.value,
    mw: 0,
    hypothetical: false,
  }));
  largeLoads.push({
    id: northWestLargeUser.id,
    name: northWestLargeUser.name,
    bus: findBus(northWestLargeUser.station, northWestLargeUser.kv),
    share: 0,
    mw: 0, // off until the connection request is studied
    hypothetical: true,
  });

  const demandWeight = new Float64Array(buses.length);
  for (const [busId, w] of Object.entries(allocation.demandWeights)) {
    const idx = busIndex.get(busId);
    if (idx !== undefined) demandWeight[idx] = w;
  }

  for (const o of branchOverrides) {
    const b = branches.find((x) => x.label === o.match);
    if (!b || !o.circuits || b.kind === 'transformer') continue;
    const k = o.circuits / b.circuits;
    b.x /= k;
    b.winterMVA *= k;
    b.summerMVA *= k;
    b.circuits = o.circuits;
  }

  const slack = findBus('Woodland', 400);
  void renewables;
  void storage;

  return {
    buses,
    branches,
    hvdcRoutes,
    units: modelUnits,
    interconnectors: ics,
    wind,
    solar,
    batteries,
    largeLoads,
    demandWeight,
    slack,
    busIndex,
    nodeById,
  };
}
