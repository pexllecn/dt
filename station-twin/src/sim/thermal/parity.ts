/**
 * The prototype's first-order thermal model, kept exactly for the parity preset.
 * It is not used by the demo: its cooling factor scales ambient as well as the rise, and it
 * trips at a 93 °C "hot-spot", which IEC 60076-7 would not. See docs/PLAN.md, 4.1 and 4.2.
 */
import type { Sys, Transformer } from '../types.ts';

/** Returns true if this call tripped the unit. Mirrors the prototype's loop body exactly. */
export function parityThermalStep(c: Transformer, sys: Sys, dt: number): boolean {
  if (!c.live) {
    c.temp = Math.max(24, c.temp - 0.7 * dt * 2);
    return false;
  }
  const cf = c.cool ? 0.74 : 1.0;
  const target = (26 + (c.loadPU || 0) * 64 + (c.drift || 0)) * cf;
  c.temp += (target - c.temp) * Math.min(1, 0.09 * dt * 2.5);
  if ((c.loadPU > 1.25 || c.temp > 93) && !c.tripped) {
    c.ot = (c.ot || 0) + dt;
    if (c.ot > 5) {
      c.tripped = true;
      c.closed = false;
      c.tripCause = 'Overload (prototype rule)';
      sys.reliability = Math.max(0, sys.reliability - 8);
      return true;
    }
  } else {
    c.ot = Math.max(0, (c.ot || 0) - dt);
  }
  return false;
}
