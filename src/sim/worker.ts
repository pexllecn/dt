/// <reference lib="webworker" />
import { Engine } from './engine';
import { scenarios } from './scenarios';
import type { FromWorker, ModelMeta, SimInputs, ToWorker } from './protocol';
import type { NetworkBundle } from './types';

/**
 * The simulation runs here, off the render thread. It owns the engine and recomputes a whole
 * scenario day (96 intervals, flows and N-1) whenever inputs change. Deterministic: the same
 * inputs always give the same result.
 */
let engine: Engine | null = null;
const post = (m: FromWorker, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(m, transfer);

function run(inputs: SimInputs) {
  if (!engine) return;
  const t0 = performance.now();
  const sc = scenarios[inputs.scenario];
  const m = engine.model;
  const outages = inputs.outages.map((id) => m.branches.findIndex((b) => b.id === id)).filter((i) => i >= 0);
  const extra: Record<number, number> = {};
  for (const [busId, mw] of Object.entries(inputs.extraLoad)) {
    const idx = m.busIndex.get(busId);
    if (idx !== undefined && mw) extra[idx] = mw;
  }
  const day = engine.runDay({
    date: sc.date,
    year: inputs.year ?? sc.year,
    wind: { reference: sc.windRef, front: sc.front, seed: sc.seed, scale: inputs.windScale },
    icShare: inputs.icShare ?? sc.icShare,
    extraLoad: extra,
    outages,
    unitOutages: [],
  });
  const buffers = [
    day.flows.buffer,
    day.loading.buffer,
    day.n1Loading.buffer,
    day.n1Cause.buffer,
    day.unitMW.buffer,
    day.injections.buffer,
    day.busLoad.buffer,
    day.windMW.buffer,
    day.windSpeed.buffer,
    ...Object.values(day.series).map((a) => a.buffer),
  ] as ArrayBuffer[];
  post({ type: 'day', day, inputs, ms: performance.now() - t0 }, buffers);
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      const t0 = performance.now();
      const get = async (f: string) => {
        const r = await fetch(`${msg.base}data/network/${f}`);
        if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
        return r.json();
      };
      const [network, allocation, plants] = await Promise.all([get('network.json'), get('allocation.json'), get('plants.json')]);
      engine = new Engine({ network, allocation, plants } as NetworkBundle);
      const m = engine.model;
      const meta: ModelMeta = {
        branches: m.branches.map((b) => {
          const ca = m.buses[b.from]!.country;
          const cb = m.buses[b.to]!.country;
          return {
            id: b.id,
            label: b.label,
            kv: b.kv,
            kind: b.kind,
            from: m.buses[b.from]!.id,
            to: m.buses[b.to]!.id,
            circuits: b.unit ? b.unit.count : b.circuits,
            country: ca === cb ? ca : 'X',
            lengthKm: b.lengthKm,
          };
        }),
        buses: m.buses.map((b) => ({ id: b.id, node: b.node.id, kv: b.kv })),
        units: m.units.map((u) => ({ id: u.spec.id, name: u.spec.name, bus: m.buses[u.bus]!.id, capacity: u.capacity })),
        wind: m.wind.map((w) => ({ bus: m.buses[w.bus]!.id, name: w.name, e: w.e, n: w.n })),
        contingencyLabels: m.branches.map((_, k) => engine!.contingencyLabel(k)),
      };
      post({ type: 'ready', meta, ms: performance.now() - t0 });
      run(msg.inputs);
    } else if (msg.type === 'inputs') {
      run(msg.inputs);
    }
  } catch (e) {
    post({ type: 'error', message: String(e) });
  }
};
