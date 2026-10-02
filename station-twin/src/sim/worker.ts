/// <reference lib="webworker" />
/**
 * Simulation worker: runs the engine on a fixed step, converting wall time to simulated time
 * with the selected compression, and posts snapshots for the renderer to interpolate.
 */
import { CLOCK } from '../config/assumptions.ts';
import { Engine } from './engine.ts';
import type { ClockState, FromWorker, ToWorker } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

let engine = new Engine({ preset: 'engineering', seed: 1 });
const clock: ClockState = { compression: CLOCK.defaultCompression.value, effective: CLOCK.defaultCompression.value, paused: false };
let accumulator = 0;
let last = performance.now();
const STEP = CLOCK.stepS.value;
const MAX_STEPS_PER_TICK = 4000;

const post = (m: FromWorker) => self.postMessage(m);

function snapshot(): void {
  const state = engine.snapshot();
  // Keep only the latest frequency transient series to limit message size.
  state.frequency.events = state.frequency.events.map((ev, i, all) => (i === all.length - 1 ? ev : { ...ev, series: [] }));
  post({ type: 'snapshot', state, clock: { ...clock }, hash: null });
}

function tick(): void {
  const now = performance.now();
  const wall = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (!clock.paused) {
    clock.effective = engine.s.fastForwardTo !== null ? CLOCK.timeLapse.value : clock.compression;
    if (engine.preset === 'parity') {
      engine.step(wall);
    } else {
      accumulator += wall * clock.effective;
      let n = Math.floor(accumulator / STEP);
      if (n > MAX_STEPS_PER_TICK) { n = MAX_STEPS_PER_TICK; accumulator = 0; } else accumulator -= n * STEP;
      for (let i = 0; i < n; i++) {
        engine.step(STEP);
        if (engine.s.fastForwardTo === null && clock.effective !== clock.compression) { clock.effective = clock.compression; accumulator = 0; break; }
      }
    }
  }
  snapshot();
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  switch (m.type) {
    case 'init':
      engine = new Engine({ preset: m.preset, seed: m.seed });
      accumulator = 0;
      snapshot();
      break;
    case 'command':
      post({ type: 'result', id: m.id, result: engine.command(m.cmd) });
      snapshot();
      break;
    case 'clock':
      if (m.compression !== undefined) clock.compression = m.compression;
      if (m.paused !== undefined) clock.paused = m.paused;
      clock.effective = clock.compression;
      snapshot();
      break;
  }
};

setInterval(tick, 1000 / 15);
snapshot();
