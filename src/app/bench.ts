import { create } from 'zustand';
import { itmToScene, lonLatToItm } from '@/lib/geo';

/** A camera keyframe: look-at point (lon, lat), distance, polar angle and azimuth (degrees). */
export type Key = [lon: number, lat: number, dist: number, polar: number, az: number];

export interface BenchSegment {
  name: string;
  seconds: number;
  from: Key;
  to: Key;
}

/** Fixed path: national, regional (north Mayo), site scale (Bellacorick area), back up to regional. */
export const benchPath: BenchSegment[] = [
  { name: 'national', seconds: 10, from: [-7.75, 53.3, 760_000, 34, -10], to: [-8.2, 53.6, 520_000, 40, 10] },
  { name: 'regional', seconds: 10, from: [-9.4, 54.05, 70_000, 55, 200], to: [-9.6, 54.1, 25_000, 62, 230] },
  { name: 'site', seconds: 10, from: [-9.62, 54.12, 4_000, 68, 240], to: [-9.58, 54.14, 1_200, 72, 290] },
];

export interface BenchResult {
  backend: string;
  width: number;
  height: number;
  dpr: number;
  userAgent: string;
  segments: { name: string; frames: number; p50: number; p95: number; max: number; fps: number }[];
}

export const useBench = create<{ result: BenchResult | null; running: boolean; set(r: Partial<{ result: BenchResult | null; running: boolean }>): void }>(
  (set) => ({ result: null, running: false, set: (r) => set(r) }),
);

export function keyToLookAt(k: Key): [number, number, number, number, number, number] {
  const p = lonLatToItm(k[0], k[1]);
  const [x, z] = itmToScene(p.e, p.n);
  const pol = (k[3] * Math.PI) / 180;
  const az = (k[4] * Math.PI) / 180;
  return [x + k[2] * Math.sin(pol) * Math.sin(az), k[2] * Math.cos(pol), z + k[2] * Math.sin(pol) * Math.cos(az), x, 0, z];
}

export function lerpKey(a: Key, b: Key, t: number): Key {
  const e = t * t * (3 - 2 * t);
  const logD = Math.log(a[2]) + (Math.log(b[2]) - Math.log(a[2])) * e;
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, Math.exp(logD), a[3] + (b[3] - a[3]) * e, a[4] + (b[4] - a[4]) * e];
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}
