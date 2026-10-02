/** Simulation client: the worker in normal use, a main-thread engine for deterministic capture. */
import { Engine, type Command, type CommandResult } from '../sim/engine.ts';
import type { FromWorker, ToWorker } from '../sim/protocol.ts';
import SimWorker from '../sim/worker.ts?worker&inline';
import { clock, recordHistory, snap } from './store.ts';

export interface SimClient {
  command(cmd: Command): Promise<CommandResult>;
  setClock(c: { compression?: number; paused?: boolean }): void;
}

export function workerClient(): SimClient {
  const worker = new SimWorker();
  let nextId = 1;
  const pending = new Map<number, (r: CommandResult) => void>();
  worker.onmessage = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    if (m.type === 'snapshot') {
      snap.value = m.state;
      clock.value = m.clock;
      recordHistory(m.state);
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
  };
}

/** Synchronous engine on the main thread, for capture mode and tests. */
export function localClient(engine: Engine): SimClient {
  const publish = () => { snap.value = engine.snapshot(); recordHistory(snap.value); };
  publish();
  return {
    async command(cmd) { const r = engine.command(cmd); publish(); return r; },
    setClock(c) { clock.value = { ...clock.value, ...c, effective: c.compression ?? clock.value.compression }; },
  };
}
