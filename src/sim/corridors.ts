import type { DayResult } from './engine';
import type { ModelMeta } from './protocol';

export interface Corridor {
  rank: number;
  /** Worst circuit in the corridor (selected and framed). */
  branch: string;
  label: string;
  kv: number;
  /** Circuits in the corridor (series circuits through the same station are one corridor). */
  branches: string[];
  /** Hours in the day with worst single-outage loading above 100%. */
  hoursN1: number;
  /** Hours above 100% with everything in service. */
  hoursIntact: number;
  peakN1: number;
  peakIntact: number;
  /** Strain in MWh above rating over the day (intact counted double). */
  score: number;
  /** Strain the same day had at the base year's demand. */
  baseScore: number;
  /** Midpoint (ITM) for labels and camera. */
  e: number;
  n: number;
}

interface Strain {
  l: number;
  score: number;
  hN1: number;
  hIn: number;
  pN1: number;
  pIn: number;
}

function strain(day: DayResult, nb: number, l: number): Strain {
  const rating = day.ratings[l]!;
  const r: Strain = { l, score: 0, hN1: 0, hIn: 0, pN1: 0, pIn: 0 };
  for (let s = 0; s < 96; s++) {
    const n1 = day.n1Loading[s * nb + l]!;
    const ld = day.loading[s * nb + l]!;
    if (n1 > 1) {
      r.hN1 += 0.25;
      r.score += (n1 - 1) * rating * 0.25;
    }
    if (ld > 1) {
      r.hIn += 0.25;
      r.score += (ld - 1) * rating * 0.25 * 2;
    }
    r.pN1 = Math.max(r.pN1, n1);
    r.pIn = Math.max(r.pIn, ld);
  }
  return r;
}

/**
 * Rank corridors by strain (METHOD-CORRIDOR-01): energy above rating over the day, after any
 * single fault, with overloads with nothing out counted double. With a base day, the ranking is
 * by the strain growth adds (target minus base), so constraints that exist today do not crowd
 * out the ones demand growth creates. Circuits in series through the same station, both
 * strained, form one corridor.
 */
export function topCorridors(day: DayResult, meta: ModelMeta, count = 5, base?: DayResult): Corridor[] {
  const nb = meta.branches.length;
  const bus = new Map(meta.buses.map((b) => [b.id, b]));
  const cands: (Strain & { added: number; baseScore: number })[] = [];
  meta.branches.forEach((b, l) => {
    if (b.country === 'NI') return;
    const s = strain(day, nb, l);
    if (s.score <= 0) return;
    const baseScore = base ? strain(base, nb, l).score : 0;
    const added = s.score - baseScore;
    if (base && added <= s.score * 0.1) return;
    cands.push({ ...s, added, baseScore });
  });
  cands.sort((a, b) => b.added - a.added);

  // Group: a strained circuit joins a corridor when it shares a station (node) with one of its circuits.
  const nodeOf = (busId: string) => bus.get(busId)?.node ?? busId;
  const groups: { members: typeof cands; nodes: Set<string> }[] = [];
  for (const c of cands) {
    const br = meta.branches[c.l]!;
    const ends = [nodeOf(br.from), nodeOf(br.to)];
    const g = groups.find((x) => ends.some((n) => x.nodes.has(n)) && meta.branches[x.members[0]!.l]!.kv === br.kv);
    if (g) {
      g.members.push(c);
      ends.forEach((n) => g.nodes.add(n));
    } else groups.push({ members: [c], nodes: new Set(ends) });
  }

  const tidy = (t: string) => t.replace(/tee near /g, '').replace(/ area station/g, '');
  const label = (members: typeof cands): string => {
    const first = meta.branches[members[0]!.l]!;
    if (members.length === 1) return first.label;
    // Ends of the chain: stations that appear once among the circuits' ends.
    const seen = new Map<string, number>();
    for (const m of members) {
      const b = meta.branches[m.l]!;
      for (const id of [b.from, b.to]) {
        const n = nodeOf(id);
        seen.set(n, (seen.get(n) ?? 0) + 1);
      }
    }
    const ends = [...seen].filter(([, k]) => k === 1).map(([n]) => meta.buses.find((x) => x.node === n)?.name ?? n);
    if (ends.length === 2 && tidy(ends[0]!) !== tidy(ends[1]!)) return `${tidy(ends[0]!)} to ${tidy(ends[1]!)} ${first.kv} kV`;
    return `${tidy(first.label)} and adjoining circuits`;
  };

  return groups
    .map((g) => {
      const worst = g.members.reduce((a, b) => (b.score > a.score ? b : a));
      const br = meta.branches[worst.l]!;
      const a = bus.get(br.from);
      const z = bus.get(br.to);
      return {
        rank: 0,
        branch: br.id,
        label: label(g.members),
        kv: br.kv,
        branches: g.members.map((m) => meta.branches[m.l]!.id),
        hoursN1: Math.max(...g.members.map((m) => m.hN1)),
        hoursIntact: Math.max(...g.members.map((m) => m.hIn)),
        peakN1: Math.max(...g.members.map((m) => m.pN1)),
        peakIntact: Math.max(...g.members.map((m) => m.pIn)),
        score: g.members.reduce((s, m) => s + m.score, 0),
        baseScore: g.members.reduce((s, m) => s + m.baseScore, 0),
        added: g.members.reduce((s, m) => s + m.added, 0),
        e: a && z ? (a.e + z.e) / 2 : 0,
        n: a && z ? (a.n + z.n) / 2 : 0,
      };
    })
    .filter((c) => c.e !== 0)
    .sort((x, y) => y.added - x.added)
    .slice(0, count)
    .map(({ added: _added, ...c }, i) => ({ ...c, rank: i + 1 }));
}
