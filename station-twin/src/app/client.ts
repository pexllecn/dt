/** Simulation client: the worker in normal use, a main-thread engine for deterministic capture. */
import type { Command, CommandResult } from '../sim/engine.ts';
import type { Decision, Twin } from '../agents/twin.ts';
import type { FromWorker, ToWorker } from '../sim/protocol.ts';
import SimWorker from '../sim/worker.ts?worker&inline';
import { agents, clock, previews, recordHistory, snap } from './store.ts';
import type { SimState } from '../sim/types.ts';

export interface SimClient {
  command(cmd: Command): Promise<CommandResult>;
  setClock(c: { compression?: number; paused?: boolean }): void;
  decide(d: Decision): Promise<{ ok: boolean; reason?: string }>;
}

export function workerClient(): SimClient {
  const worker = new SimWorker();
  let nextId = 1;
  const pending = new Map<number, (r: CommandResult) => void>();
  const decided = new Map<number, (r: { ok: boolean; reason?: string }) => void>();
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    if (m.type === 'snapshot') {
      snap.value = m.state;
      clock.value = m.clock;
      agents.value = m.agents;
      recordHistory(m.state);
    } else if (m.type === 'previews') {
      previews.value = { forRec: m.forRec, states: m.states as Record<string, SimState> };
    } else if (m.type === 'decided') {
      decided.get(m.id)?.({ ok: m.ok, reason: m.reason });
      decided.delete(m.id);
    } else {
      pending.get(m.id)?.(m.result);
      pending.delete(m.id);
    }
  };
  const send = (m: ToWorker) => worker.postMessage(m);
  return {
    command(cmd) {
      const id = nextId++;
      send({ type: 'command', id, cmd });
      return new Promise((res) => pending.set(id, res));
    },
    setClock(c) { send({ type: 'clock', ...c }); },
    decide(decision) {
      const id = nextId++;
      send({ type: 'decide', id, decision });
      return new Promise((res) => decided.set(id, res));
    },
  };
}

/** Synchronous engine on the main thread, for capture mode and tests. */
export function localClient(twin: Twin): SimClient {
  let previewFor: string | null = null;
  const publish = () => {
    snap.value = twin.engine.snapshot();
    agents.value = twin.view();
    const p = twin.previews();
    if (p.forRec !== previewFor) { previewFor = p.forRec; previews.value = { forRec: p.forRec, states: structuredClone(p.states) as Record<string, SimState> }; }
    recordHistory(snap.value);
  };
  publish();
  return {
    async command(cmd) { const r = twin.command(cmd); publish(); return r; },
    async decide(d) { const r = twin.decide(d); publish(); return r; },
    setClock(c) { clock.value = { ...clock.value, ...c, effective: c.compression ?? clock.value.compression }; },
  };
}
