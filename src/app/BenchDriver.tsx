import { useFrame, useThree } from '@react-three/fiber';
import { useRef } from 'react';
import { useWorld } from './store';
import { benchPath, keyToLookAt, lerpKey, percentile, useBench, type BenchResult } from './bench';
import type { ControlsHandle } from './ExploreControls';

const WARMUP_S = 4;

/**
 * Flies the fixed benchmark path once the world is ready and records frame times per segment.
 * Results appear on screen and in window.__benchResult (also printed to the console as JSON).
 */
export function BenchDriver({ controls }: { controls: React.RefObject<ControlsHandle | null> }) {
  const { gl, size, viewport } = useThree();
  const state = useRef({ t: -WARMUP_S, samples: benchPath.map(() => [] as number[]), done: false, last: 0 });

  useFrame(() => {
    const s = state.current;
    const c = controls.current?.controls;
    if (s.done || !c || !useWorld.getState().ready) return;
    const now = performance.now();
    const dt = s.last ? (now - s.last) / 1000 : 0;
    s.last = now;
    if (s.t < 0) {
      useBench.getState().set({ running: true });
      c.setLookAt(...keyToLookAt(benchPath[0]!.from), false);
      s.t += dt;
      return;
    }
    let t = s.t;
    let i = 0;
    while (i < benchPath.length && t > benchPath[i]!.seconds) t -= benchPath[i++]!.seconds;
    if (i >= benchPath.length) {
      s.done = true;
      const backend = (gl as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend?.isWebGPUBackend ? 'webgpu' : 'webgl';
      const result: BenchResult = {
        backend,
        width: Math.round(size.width * viewport.dpr),
        height: Math.round(size.height * viewport.dpr),
        dpr: viewport.dpr,
        userAgent: navigator.userAgent,
        segments: benchPath.map((seg, k) => {
          const ms = [...s.samples[k]!].sort((a, b) => a - b);
          const mean = ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length);
          return { name: seg.name, frames: ms.length, p50: percentile(ms, 50), p95: percentile(ms, 95), max: ms[ms.length - 1] ?? 0, fps: 1000 / Math.max(mean, 1e-3) };
        }),
      };
      (window as unknown as { __benchResult?: BenchResult }).__benchResult = result;
      console.log('BENCH', JSON.stringify(result));
      useBench.getState().set({ result, running: false });
      return;
    }
    const seg = benchPath[i]!;
    c.setLookAt(...keyToLookAt(lerpKey(seg.from, seg.to, t / seg.seconds)), false);
    if (dt > 0) s.samples[i]!.push(dt * 1000);
    s.t += dt;
  }, 0);

  return null;
}
