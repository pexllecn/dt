import { create } from 'zustand';
import type { DayResult } from './engine';
import type { AgentDay } from '@/agents/engine';
import type { FromWorker, ModelMeta, SimInputs, ToWorker } from './protocol';
import { scenarios, type ScenarioId } from './scenarios';
import type { StudyBundle } from './studies';
import type { Corridor } from './corridors';

export interface SimState {
  meta: ModelMeta | null;
  day: DayResult | null;
  agents: Omit<AgentDay, 'agents'> | null;
  inputs: SimInputs;
  computeMs: number;
  error: string | null;
  setInputs(patch: Partial<SimInputs>): void;
  trip(branchId: string): void;
  restore(branchId: string): void;
  study: StudyBundle | null;
  /** 2034 only: corridors ranked by the strain growth adds. */
  corridors: Corridor[] | null;
  studyRunning: boolean;
  /** Run the connection studies for new demand at a bus (results arrive in `study`). */
  runStudy(bus: string, requestMW: number, rangeMW: number): void;
  /** Switch scenario: clears user changes and applies the scenario's scripted events. */
  applyScenario(id: ScenarioId): void;
}

const defaults: SimInputs = {
  scenario: 'today',
  windScale: 1,
  year: null,
  icShare: null,
  extraLoad: {},
  outages: [],
  timedOutages: [],
  adjustments: [],
  commsLostFromHour: null,
  stalePolicy: 'consistency',
};

let worker: Worker | null = null;
const send = (m: ToWorker) => worker?.postMessage(m);

export const useSim = create<SimState>((set, get) => ({
  meta: null,
  day: null,
  agents: null,
  inputs: defaults,
  computeMs: 0,
  error: null,
  study: null,
  corridors: null,
  studyRunning: false,
  runStudy(bus, requestMW, rangeMW) {
    set({ studyRunning: true });
    send({ type: 'study', bus, requestMW, rangeMW });
  },
  setInputs(patch) {
    const inputs = { ...get().inputs, ...patch };
    set({ inputs });
    send({ type: 'inputs', inputs });
  },
  trip(id) {
    const outages = [...new Set([...get().inputs.outages, id])];
    get().setInputs({ outages });
  },
  restore(id) {
    get().setInputs({ outages: get().inputs.outages.filter((o) => o !== id) });
  },
  applyScenario(id) {
    const meta = get().meta;
    const ev = scenarios[id].events;
    const timedOutages = (ev?.trips ?? []).flatMap((t) => {
      const b = meta?.branches.find((x) => x.label === t.label);
      return b ? [{ id: b.id, fromHour: t.hour }] : [];
    });
    get().setInputs({
      scenario: id,
      windScale: 1,
      year: null,
      icShare: null,
      extraLoad: {},
      outages: [],
      timedOutages,
      adjustments: [],
      commsLostFromHour: ev?.commsLostHour ?? null,
    });
  },
}));

/** Start the simulation worker once. */
export function startSimulation(): void {
  if (worker) return;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    if (m.type === 'ready') {
      useSim.setState({ meta: m.meta });
      // Deep links for rehearsal and screenshots: ?scenario=storm&policy=availability
      const q = new URLSearchParams(location.search);
      const sc = q.get('scenario');
      if (sc && sc in scenarios) useSim.getState().applyScenario(sc as ScenarioId);
      const policy = q.get('policy');
      if (policy === 'availability' || policy === 'consistency') useSim.getState().setInputs({ stalePolicy: policy });
    }
    else if (m.type === 'day') useSim.setState({ day: m.day, agents: m.agents, corridors: m.corridors, computeMs: m.ms });
    else if (m.type === 'study') useSim.setState({ study: m.bundle, studyRunning: false });
    else if (m.type === 'error') {
      console.error('simulation:', m.message);
      useSim.setState({ error: m.message });
    }
  };
  send({ type: 'init', base: import.meta.env.BASE_URL, inputs: useSim.getState().inputs });
}

/** Linear interpolation of a per-branch day array at a fractional hour. */
export function sampleBranch(arr: Float32Array, nb: number, hours: number, out: Float32Array): Float32Array {
  const pos = Math.min(95.999, Math.max(0, hours / 0.25));
  const s0 = Math.floor(pos);
  const s1 = Math.min(95, s0 + 1);
  const f = pos - s0;
  for (let i = 0; i < nb; i++) out[i] = arr[s0 * nb + i]! * (1 - f) + arr[s1 * nb + i]! * f;
  return out;
}

export function sampleSeries(arr: Float32Array, hours: number): number {
  const pos = Math.min(95.999, Math.max(0, hours / 0.25));
  const s0 = Math.floor(pos);
  const s1 = Math.min(95, s0 + 1);
  const f = pos - s0;
  return arr[s0]! * (1 - f) + arr[s1]! * f;
}
