/**
 * How solver results map onto conductors for the Flow lens. Every flow path in the scene runs
 * outward: from its busbar towards the far end of the bay and on along the line (the bus
 * section runs from section A to section B; the 275 kV bay from T4 towards the border).
 * bayFlow gives the MW flowing in that direction, so a positive value moves particles from
 * the first point of a path to its last. Pure, so tests can check it against the solver.
 */
import type { SimState } from '../sim/types.ts';
import type { Voltage } from './layout.ts';

export interface BayFlow {
  /** Signed MW along the path direction. */
  mw: number;
  /** Conductor energised. */
  live: boolean;
  voltage: Voltage;
  /** MW at which the glow is at full strength (a visual scale, not a rating). */
  scale: number;
}

const SCALE: Record<Voltage, number> = { 400: 900, 275: 300, 220: 400, 110: 150 };

export function bayFlow(key: string, s: SimState): BayFlow | null {
  const C = s.C;
  const r = s.results;
  const f = (mw: number, live: boolean, voltage: Voltage): BayFlow => ({ mw, live, voltage, scale: SCALE[voltage] });
  switch (key) {
    // 400 kV circuits: the infeed is + into the station, so outward is its negative, shared by the two circuits.
    case 'L400-1': case 'L400-2': return f(-r.gridFlow / 2, C.GRID.live, 400);
    case 'T1-HV': return f(r.txFlow.T1, C.T1.live, 400);
    case 'T2-HV': return f(r.txFlow.T2, C.T2.live, 400);
    case 'T1-LV': return f(-r.txFlow.T1, C.T1.live, 220);
    case 'T2-LV': return f(-r.txFlow.T2, C.T2.live, 220);
    case 'T3-220': return f(r.txFlow.T3, C.T3.live, 220);
    case 'T3-110': return f(-r.txFlow.T3, C.T3.live, 110);
    // The border flow (+ = export to Northern Ireland) passes through T4 from 220 kV to 275 kV.
    case 'T4-220': return f(C.TIE_NI.mwNow, C.TIE_NI.live || C.T4.live, 220);
    case 'T4-275': return f(C.TIE_NI.mwNow, C.TIE_NI.live, 275);
    // Generation and the neighbour ties inject into the bus; demand withdraws.
    case 'WIND': return f(-C.WIND.mwNow, C.WIND.live && C.WIND.installed, 220);
    case 'SOLAR': return f(-C.SOLAR.mwNow, C.SOLAR.live && C.SOLAR.installed, 220);
    case 'GAS': return f(-C.GAS.mwNow, C.GAS.live && C.GAS.installed, 220);
    case 'BESS': return f(-C.BESS.mwNow, C.BESS.live && C.BESS.installed, 220);
    case 'TIE_N': return f(-C.TIE_N.mwNow, C.TIE_N.live, 220);
    case 'TIE_S': return f(-C.TIE_S.mwNow, C.TIE_S.live, 110);
    case 'REG-A': return f(r.regional.A, C.BUS220A.live, 220);
    case 'REG-B': return f(r.regional.B, C.BUS220B.live, 220);
    case 'LD_NEW': return f(C.LD_NEW.mwNow, C.LD_NEW.live && C.LD_NEW.installed, 220);
    case 'LD_IND': return f(C.LD_IND.mwNow, C.LD_IND.live, 110);
    case 'BS220': return f(r.bsFlow, C.BS220.live && C.BUS220A.live && C.BUS220B.live, 220);
    default: return null;
  }
}

/** Particle speed in metres per second at a view scale of 1: proportional to MW, signed by direction. */
export const SPEED_PER_MW = 0.045;
export function particleVelocity(mw: number, viewScale = 1): number {
  if (Math.abs(mw) < 0.5) return 0;
  return mw * SPEED_PER_MW * viewScale;
}

/** Advance a particle's position along a path (0 to 1), wrapping at either end. */
export function advance(s: number, velocity: number, length: number, dt: number): number {
  const next = s + (velocity * dt) / Math.max(1, length);
  return next - Math.floor(next);
}
