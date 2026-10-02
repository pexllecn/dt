import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/sim/engine.ts';

describe('switching and interlocks', () => {
  it('refuses to open a disconnector under load and explains why', () => {
    const e = new Engine();
    const r = e.command({ type: 'operate', id: 'TIE_N', device: 'dsLine', action: 'open' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Open the circuit breaker first/);
  });
  it('refuses to earth a circuit whose disconnectors are closed', () => {
    const e = new Engine();
    e.command({ type: 'operate', id: 'TIE_N', device: 'cb', action: 'open' });
    expect(e.command({ type: 'operate', id: 'TIE_N', device: 'es', action: 'close' }).ok).toBe(false);
  });
  it('runs a take-out-of-service programme then a return-to-service programme', () => {
    const e = new Engine();
    expect(e.command({ type: 'programme', id: 'TIE_N', programme: 'outOfService' }).ok).toBe(true);
    expect(e.s.condition).toBe('Restoring');
    e.advance(200);
    expect(e.s.C.TIE_N.closed).toBe(false);
    expect(e.s.C.TIE_N.bay).toEqual({ dsBus: false, dsLine: false, es: true });
    expect(e.command({ type: 'operate', id: 'TIE_N', device: 'cb', action: 'close' }).reason).toMatch(/disconnectors/);
    e.command({ type: 'programme', id: 'TIE_N', programme: 'returnToService' });
    e.advance(200);
    expect(e.s.C.TIE_N.closed).toBe(true);
    expect(e.s.C.TIE_N.bay).toEqual({ dsBus: true, dsLine: true, es: false });
  });
  it('keeps a tripped unit locked out until a person confirms', () => {
    const e = new Engine();
    e.command({ type: 'scenario', id: 'n1' });
    expect(e.command({ type: 'operate', id: 'T1', device: 'cb', action: 'close' }).ok).toBe(false);
    expect(e.command({ type: 'resetProtection', id: 'T1', confirmed: false }).ok).toBe(false);
    expect(e.command({ type: 'resetProtection', id: 'T1', confirmed: true }).ok).toBe(true);
    expect(e.command({ type: 'operate', id: 'T1', device: 'cb', action: 'close' }).ok).toBe(true);
    expect(e.s.C.T1.live).toBe(true);
  });
});
