/// <reference lib="webworker" />
/**
 * Simulation worker: runs the engine on a fixed step, converting wall time to simulated time
 * with the selected compression, and posts snapshots for the renderer to interpolate.
 */
import { CLOCK } from '../config/assumptions.ts';
import { Twin } from '../agents/twin.ts';
import { BEATS, TourRunner } from '../tour/tour.ts';
import type { ClockState, FromWorker, ToWorker } from './protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

let twin = new Twin({ preset: 'engineering', seed: 1 });
let engine = twin.engine;
let previewFor: string | null = null;
let runner: TourRunner | null = null;
let tourWall = new Date().toISOString();

/** Apply the beat's clock: its compression, paused when it waits for the presenter. */
function beatClock(): void {
  if (!runner) return;
  const b = BEATS[runner.beat]!;
  clock.compression = b.compression || clock.compression;
  clock.effective = clock.compression;
  clock.paused = b.compression === 0 || runner.awaiting !== null;
  accumulator = 0;
}
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
  post({ type: 'snapshot', state, clock: { ...clock }, hash: null, agents: twin.view(), tour: runner ? runner.status(twin) : null });
  const p = twin.previews();
  if (p.forRec !== previewFor) { previewFor = p.forRec; post({ type: 'previews', forRec: p.forRec, states: p.states }); }
}

function tick(): void {
  const now = performance.now();
  const wall = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (!clock.paused) {
    clock.effective = engine.s.fastForwardTo !== null ? CLOCK.timeLapse.value : clock.compression;
    if (engine.preset === 'parity') {
      twin.step(wall);
    } else {
      accumulator += wall * clock.effective;
      let n = Math.floor(accumulator / STEP);
      if (n > MAX_STEPS_PER_TICK) { n = MAX_STEPS_PER_TICK; accumulator = 0; } else accumulator -= n * STEP;
      twin.fast = runner ? false : n > 200;
      for (let i = 0; i < n; i++) {
        twin.step(STEP);
        if (runner && runner.after(twin)) { clock.paused = true; accumulator = 0; break; }
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
      twin = new Twin({ preset: m.preset, seed: m.seed });
      engine = twin.engine;
      accumulator = 0;
      snapshot();
      break;
    case 'command':
      post({ type: 'result', id: m.id, result: twin.command(m.cmd) });
      engine = twin.engine;
      snapshot();
      break;
    case 'decide': {
      const r = twin.decide(m.decision);
      engine = twin.engine;
      post({ type: 'decided', id: m.id, ...r });
      snapshot();
      break;
    }
    case 'tour': {
      tourWall = m.wall;
      if (m.action === 'stop') { runner = null; snapshot(); break; }
      if (m.action === 'start' || (m.action === 'prev' && runner)) {
        const k = m.action === 'start' ? 0 : Math.max(0, runner!.beat - 1);
        const built = TourRunner.at(k, () => new Twin({ preset: 'engineering', seed: 1 }), () => tourWall);
        twin = built.twin; runner = built.runner; engine = twin.engine; previewFor = null;
      } else if (m.action === 'next' && runner) {
        runner.next(twin);
      }
      beatClock();
      snapshot();
      break;
    }
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
