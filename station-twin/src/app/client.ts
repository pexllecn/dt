/** Simulation client: the worker in normal use, a main-thread engine for deterministic capture. */
import type { Command, CommandResult } from '../sim/engine.ts';
import type { Decision, Twin } from '../agents/twin.ts';
import type { FromWorker, ToWorker } from '../sim/protocol.ts';
import SimWorker from '../sim/worker.ts?worker&inline';
import { agents, clock, previews, recordHistory, snap, tour } from './store.ts';
import { BEATS, TourRunner } from '../tour/tour.ts';
import { Twin as TwinClass } from '../agents/twin.ts';
import type { TourAction } from '../sim/protocol.ts';
import type { SimState } from '../sim/types.ts';

export interface SimClient {
  command(cmd: Command): Promise<CommandResult>;
  setClock(c: { compression?: number; paused?: boolean }): void;
  decide(d: Decision): Promise<{ ok: boolean; reason?: string }>;
  tour(action: TourAction): void;
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
      tour.value = m.tour;
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
    tour(action) { send({ type: 'tour', action, wall: new Date().toISOString() }); },
    decide(decision) {
      const id = nextId++;
      send({ type: 'decide', id, decision });
      return new Promise((res) => decided.set(id, res));
    },
  };
}

/** Synchronous engine on the main thread, for capture mode and tests. */
export function localClient(initial: Twin): SimClient {
  let twin = initial;
  let runner: TourRunner | null = null;
  let previewFor: string | null = null;
  const publish = () => {
    tour.value = runner ? runner.status(twin) : null;
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
    tour(action) {
      // Capture mode: the same runner, synchronously, with a fixed wall clock.
      const wall = () => '2026-03-11T07:40:00.000Z';
      if (action === 'stop') runner = null;
      else if (action === 'start' || (action === 'prev' && runner)) {
        const built = TourRunner.at(action === 'start' ? 0 : Math.max(0, runner!.beat - 1), () => new TwinClass(), wall);
        twin = built.twin; runner = built.runner; previewFor = null;
      } else if (action === 'next' && runner) runner.next(twin);
      else if (action === 'run' && runner) { runner.awaiting = null; for (let i = 0; i < 20000; i++) { twin.step(); if (runner.after(twin)) break; } }
      void BEATS;
      publish();
    },
    setClock(c) { clock.value = { ...clock.value, ...c, effective: c.compression ?? clock.value.compression }; },
  };
}
