/**
 * Parity: the TypeScript port, in its parity preset, must reproduce the original prototype for
 * every scenario and action sequence. Fixtures come from executing the prototype itself
 * (tests/parity/generate-fixtures.mjs), so this compares against the original, not a reading of it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Engine, type Command } from '../../src/sim/engine.ts';
import type { ComponentId } from '../../src/sim/types.ts';
import { CASES, CHECKPOINTS, FRAME_DT } from './cases.mjs';

interface ProtoRecord {
  t: number;
  C: Record<string, Record<string, unknown>>;
  SYS: Record<string, unknown>;
  R: { gridFlow: number; t3Flow: number; supply: number; demand: number; renewPct: number; unbal: number; parts: { sup: { k: string; v: number }[]; dem: { k: string; v: number }[] } };
}
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/prototype.json', import.meta.url), 'utf8')) as { cases: Record<string, ProtoRecord[]> };

function toCommand(a: Record<string, unknown>): Command {
  if (a.scenario) return { type: 'scenario', id: a.scenario as never };
  if (a.set) { const [id, field, value] = a.set as [ComponentId, string, number | boolean]; return { type: 'set', id, field, value }; }
  if (a.setSys) { const [, value] = a.setSys as [string, number]; return { type: 'setSys', field: 'shedMW', value }; }
  if (a.toggle) return { type: 'toggle', id: a.toggle as ComponentId };
  if (a.autoBalance) return { type: 'rebalance' };
  if (a.clearFault) return { type: 'clearBusFault', section: 'A', confirmed: true };
  if (a.recouple) return { type: 'couple', coupled: true };
  throw new Error(`unknown action ${JSON.stringify(a)}`);
}

const PROTO_IDS = ['GRID', 'BUS400', 'T1', 'T2', 'BUS220', 'T3', 'BUS110', 'WIND', 'SOLAR', 'GAS', 'BESS', 'LD_TOWN', 'LD_NEW', 'LD_IND', 'TIE_NI', 'TIE_N', 'TIE_S'];
const FIELDS = ['closed', 'tripped', 'live', 'mwNow', 'dir', 'installed', 'loadPU', 'temp', 'soc', 'out', 'avail', 'set', 'mw', 'cool', 'drift'];
const TOL = 1e-6;

function close(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= TOL * Math.max(1, Math.abs(b));
  return a === b;
}

function compare(e: Engine, p: ProtoRecord): string[] {
  const s = e.s;
  const errs: string[] = [];
  for (const id of PROTO_IDS) {
    const mine = (id === 'BUS220' ? s.C.BUS220A : s.C[id as ComponentId]) as unknown as Record<string, unknown>;
    const theirs = p.C[id]!;
    for (const f of FIELDS) {
      if (!(f in theirs)) continue;
      let v = mine[f];
      if (f === 'drift' && theirs[f] === undefined) continue;
      if (f === 'loadPU' && id !== 'T1' && id !== 'T2' && id !== 'T3') continue;
      if (!close(v, theirs[f])) errs.push(`C.${id}.${f}: port ${String(v)} vs prototype ${String(theirs[f])}`);
    }
    if ('_ot' in theirs && !close((mine as { ot: number }).ot, theirs._ot)) errs.push(`C.${id}._ot: ${String(mine.ot)} vs ${String(theirs._ot)}`);
  }
  const sysPairs: [string, unknown][] = [
    ['freq', s.sys.freq], ['mode', s.sys.mode], ['shock', s.sys.shock], ['storm', s.sys.storm], ['coupled', s.sys.coupled],
    ['busFault', s.sys.busFault.length > 0], ['shedMW', s.sys.shedMW], ['reliability', s.sys.reliability],
  ];
  for (const [k, v] of sysPairs) if (!close(v, p.SYS[k])) errs.push(`SYS.${k}: port ${String(v)} vs prototype ${String(p.SYS[k])}`);
  const r = s.results;
  for (const k of ['gridFlow', 't3Flow', 'supply', 'demand', 'renewPct', 'unbal'] as const) {
    if (!close(r[k], p.R[k])) errs.push(`R.${k}: port ${r[k]} vs prototype ${p.R[k]}`);
  }
  for (const side of ['sup', 'dem'] as const) {
    const a = r.parts[side].map((x) => `${x.label}:${x.mw.toFixed(6)}`).join('|');
    const b = p.R.parts[side].map((x) => `${x.k}:${x.v.toFixed(6)}`).join('|');
    if (a !== b) errs.push(`R.parts.${side}: port ${a} vs prototype ${b}`);
  }
  return errs;
}

describe('parity with the original prototype', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const e = new Engine({ preset: 'parity' });
      for (const a of c.actions) e.command(toCommand(a));
      const records = fixtures.cases[c.name]!;
      let t = 0;
      CHECKPOINTS.forEach((cp, i) => {
        while (t < cp - 1e-9) { e.step(FRAME_DT); t += FRAME_DT; }
        const errs = compare(e, records[i]!);
        expect(errs, `at t=${cp}s`).toEqual([]);
      });
    });
  }
});
