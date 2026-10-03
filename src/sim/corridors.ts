import type { DayResult } from './engine';
import type { ModelMeta } from './protocol';

export interface Corridor {
  rank: number;
  branch: string;
  label: string;
  kv: number;
  /** Hours in the day with worst single-outage loading above 100%. */
  hoursN1: number;
  /** Hours above 100% with everything in service. */
  hoursIntact: number;
  peakN1: number;
  peakIntact: number;
  /** Severity score: MW-hours above rating, intact counted double. */
  score: number;
  /** Midpoint (ITM) for labels and camera. */
  e: number;
  n: number;
}

/**
 * Rank circuits by strain over the day (METHOD-CORRIDOR-01): energy above rating, with intact
 * overloads weighted double, after any single outage. Parallel circuits between the same two
 * stations count once (the worse of them).
 */
export function topCorridors(day: DayResult, meta: ModelMeta, count = 5): Corridor[] {
  const nb = meta.branches.length;
  const busPos = new Map(meta.buses.map((b) => [b.id, { e: b.e, n: b.n }]));
  const pos = { get: (bus: string) => busPos.get(bus) };
  const best = new Map<string, Corridor>();
  meta.branches.forEach((b, l) => {
    if (b.country === 'NI') return;
    let score = 0;
    let hN1 = 0;
    let hIn = 0;
    let pN1 = 0;
    let pIn = 0;
    const rating = day.ratings[l]!;
    for (let s = 0; s < 96; s++) {
      const n1 = day.n1Loading[s * nb + l]!;
      const ld = day.loading[s * nb + l]!;
      if (n1 > 1) {
        hN1 += 0.25;
        score += (n1 - 1) * rating * 0.25;
      }
      if (ld > 1) {
        hIn += 0.25;
        score += (ld - 1) * rating * 0.25 * 2;
      }
      pN1 = Math.max(pN1, n1);
      pIn = Math.max(pIn, ld);
    }
    if (score <= 0) return;
    const a = pos.get(b.from);
    const z = pos.get(b.to);
    if (!a || !z) return;
    const key = [b.from, b.to].sort().join('|');
    const c: Corridor = { rank: 0, branch: b.id, label: b.label, kv: b.kv, hoursN1: hN1, hoursIntact: hIn, peakN1: pN1, peakIntact: pIn, score, e: (a.e + z.e) / 2, n: (a.n + z.n) / 2 };
    const prev = best.get(key);
    if (!prev || prev.score < c.score) best.set(key, c);
  });
  return [...best.values()]
    .sort((x, y) => y.score - x.score)
    .slice(0, count)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}
