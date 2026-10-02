import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/sim/engine.ts';

function story(): Engine {
  const e = new Engine({ seed: 7 });
  e.command({ type: 'scenario', id: 'add_bess' });
  e.advance(3600);
  e.command({ type: 'scenario', id: 'peak' });
  e.advance(1800);
  e.command({ type: 'scenario', id: 'n1' });
  e.advance(600);
  e.command({ type: 'setBattery', mw: 80 });
  e.command({ type: 'scenario', id: 'imp_n' });
  e.advance(1800);
  e.command({ type: 'scenario', id: 'storm' });
  e.advance(4 * 3600);
  return e;
}

describe('determinism', () => {
  it('produces identical state hashes on two runs', () => {
    expect(story().stateHash()).toBe(story().stateHash());
  });
  it('rebuilds the same state by replaying the input log', () => {
    const a = story();
    const b = Engine.replay('engineering', 7, a.inputLog, a.s.t);
    expect(b.stateHash()).toBe(a.stateHash());
  });
});
