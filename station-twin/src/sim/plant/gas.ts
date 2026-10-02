/** Open-cycle gas turbine: start sequence, minimum stable generation and ramp rate. */
import { PLANT } from '../../config/assumptions.ts';
import { approach, clamp } from '../../lib/math.ts';
import type { Generator } from '../types.ts';

/** Advance the unit. `available` means built, breaker closed and its busbar energised. */
export function gasStep(g: Generator, available: boolean, dt: number): void {
  if (!available) {
    g.gasState = 'off';
    g.gasTimer = 0;
    g.actual = 0;
    return;
  }
  const msg = PLANT.gasMinStable.value * g.cap;
  const wanted = g.out > 0 ? clamp(Math.max(g.out, msg), 0, g.avail) : 0;
  const ramp = (PLANT.gasRampMwPerMin.value / 60) * dt;
  switch (g.gasState) {
    case 'off':
      g.actual = 0;
      if (wanted > 0) { g.gasState = 'starting'; g.gasTimer = 0; }
      break;
    case 'starting':
      g.actual = 0;
      if (wanted === 0) { g.gasState = 'off'; g.gasTimer = 0; break; }
      g.gasTimer += dt;
      if (g.gasTimer >= PLANT.gasSyncMin.value * 60) g.gasState = 'running';
      break;
    case 'running':
      g.actual = approach(g.actual, wanted, ramp);
      if (wanted === 0 && g.actual === 0) { g.gasState = 'off'; g.gasTimer = 0; }
      break;
  }
}

/** Minutes until full requested output, for look-ahead cards. */
export function gasMinutesToTarget(g: Generator): number {
  const msg = PLANT.gasMinStable.value * g.cap;
  const wanted = g.out > 0 ? clamp(Math.max(g.out, msg), 0, g.avail) : 0;
  const rampMin = Math.abs(wanted - g.actual) / PLANT.gasRampMwPerMin.value;
  if (g.gasState === 'off' && wanted > 0) return PLANT.gasSyncMin.value + wanted / PLANT.gasRampMwPerMin.value;
  if (g.gasState === 'starting') return PLANT.gasSyncMin.value - g.gasTimer / 60 + wanted / PLANT.gasRampMwPerMin.value;
  return rampMin;
}
