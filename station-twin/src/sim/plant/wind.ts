/** Wind farm power curve with soft high-wind cut-out and restart hysteresis. */
import { PLANT } from '../../config/assumptions.ts';

const ci = () => PLANT.windCutIn.value;
const rated = () => PLANT.windRated.value;

/** Output as a fraction of capacity. `cutOut` is the latched high-wind shutdown state. */
export function windFraction(v: number, cutOut: boolean): { fraction: number; cutOut: boolean } {
  let latched = cutOut;
  if (latched && v < PLANT.windRestart.value) latched = false;
  if (v >= PLANT.windCutOut.value) latched = true;
  if (latched || v < ci()) return { fraction: 0, cutOut: latched };
  if (v < rated()) return { fraction: (v ** 3 - ci() ** 3) / (rated() ** 3 - ci() ** 3), cutOut: false };
  if (v <= PLANT.windStormStart.value) return { fraction: 1, cutOut: false };
  const f = 1 - (v - PLANT.windStormStart.value) / (PLANT.windCutOut.value - PLANT.windStormStart.value);
  return { fraction: Math.max(0, f), cutOut: false };
}

/** Wind speed that gives a fraction of capacity, on the rising part of the curve. */
export function windSpeedFor(fraction: number): number {
  if (fraction <= 0) return ci() * 0.8;
  if (fraction >= 1) return rated() + 1;
  return Math.cbrt(fraction * (rated() ** 3 - ci() ** 3) + ci() ** 3);
}
