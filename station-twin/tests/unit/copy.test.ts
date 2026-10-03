/** Copy rules: British English, no em or en dashes, no emojis, in every user-facing string. */
import { describe, expect, it } from 'vitest';
import { assumptionTable } from '../../src/config/assumptions.ts';
import { Engine } from '../../src/sim/engine.ts';
import { createRegistry } from '../../src/sim/registry.ts';
import { runEngineeringScenario, SCENARIOS } from '../../src/sim/scenarios.ts';
import { Twin } from '../../src/agents/twin.ts';
import { ALL_RULES } from '../../src/agents/agents.ts';
import { BEATS, TourRunner } from '../../src/tour/tour.ts';

const US = /\b(colou?r(?<!colour)|center|centers|behavior|optimiz\w*|analyz\w*|organiz\w*|minimiz\w*|maximiz\w*|prioritiz\w*|stabiliz\w*|normaliz\w*|energiz\w*|synchroniz\w*|authoriz\w*|recogniz\w*|realiz\w*|favor\w*|labor|meter(?!ed)|program(?!me)|license(?!d)|defense|catalog(?!ue)|gray|modeling|modeled|traveled|canceled|fueled)\b/i;
const DASH = /[\u2013\u2014]/;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

function collect(): string[] {
  const out: string[] = [];
  for (const s of SCENARIOS) out.push(s.title, s.description);
  const reg = createRegistry('engineering');
  for (const c of Object.values(reg)) out.push(c.name, c.note);
  for (const r of assumptionTable()) out.push(r.label, r.note, r.value);
  // Outcome copy and every log line produced by a long story.
  const e = new Engine();
  for (const s of SCENARIOS) {
    const probe = new Engine();
    const o = runEngineeringScenario(probe.s, s.id);
    out.push(o.title, o.detail);
  }
  for (const id of ['add_solar', 'add_bess', 'add_gas', 'peak', 'n1', 'busfault', 'storm', 'split'] as const) {
    const r = e.command({ type: 'scenario', id });
    out.push(r.title, r.detail, ...r.deltas.map((d) => d.label));
    e.advance(3600);
  }
  out.push(...e.s.log.map((l) => l.text));
  for (const ev of e.s.frequency.events) out.push(ev.cause);
  out.push(e.command({ type: 'operate', id: 'TIE_N', device: 'dsLine', action: 'open' }).detail);
  // Agents: rule text, threshold labels, and every trace and narration a full guided tour produces.
  for (const r of Object.values(ALL_RULES).flat()) out.push(r.description, r.threshold.label, r.threshold.note ?? '');
  for (const b of BEATS) out.push(b.title, b.caption);
  const { twin, runner } = TourRunner.at(0, () => new Twin(), () => 'w');
  for (let i = 0; i < 40; i++) { out.push(runner.status(twin).nextAction); if (runner.next(twin) === 'end') break; }
  for (const f of twin.agents.feed) out.push(f.text, f.narration);
  for (const r of twin.coord.state.recommendations) out.push(r.trigger, ...r.options.map((o) => o.label));
  return out.filter((x) => x.length > 0);
}

describe('copy', () => {
  const strings = collect();
  it('has strings to check', () => expect(strings.length).toBeGreaterThan(150));
  it('has no em or en dashes', () => expect(strings.filter((s) => DASH.test(s))).toEqual([]));
  it('has no emojis', () => expect(strings.filter((s) => EMOJI.test(s))).toEqual([]));
  it('uses British spellings', () => expect(strings.filter((s) => US.test(s))).toEqual([]));
  it('never mentions EirGrid', () => expect(strings.filter((s) => /eirgrid/i.test(s))).toEqual([]));
});

describe('provenance', () => {
  const rows = assumptionTable();
  it('labels every figure with a source type', () => {
    for (const r of rows) expect(['Typical value', 'Assumption', 'Simplification']).toContain(r.source);
  });
  it('has unique ids', () => expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length));
});
