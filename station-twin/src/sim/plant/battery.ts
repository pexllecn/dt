/** Battery power limits and energy accounting with round-trip efficiency. */
import { PLANT } from '../../config/assumptions.ts';
import { clamp } from '../../lib/math.ts';
import type { Battery } from '../types.ts';

const oneWay = () => Math.sqrt(PLANT.batteryRoundTrip.value);

/** Power the battery will deliver this step (+ discharge), before network gating. */
export function batteryPower(b: Battery): number {
  const p = clamp(b.set, -b.cap, b.cap);
  if (p > 0 && b.soc <= PLANT.batterySocMin.value) return 0;
  if (p < 0 && b.soc >= PLANT.batterySocMax.value) return 0;
  return p;
}

/** Integrate state of charge for the power actually exchanged with the busbar. */
export function batteryEnergyStep(b: Battery, power: number, dt: number): void {
  let energy = (b.soc / 100) * b.energyCap;
  const h = dt / 3600;
  if (power > 0) energy -= (power * h) / oneWay();
  else if (power < 0) energy += -power * h * oneWay();
  b.soc = clamp((energy / b.energyCap) * 100, 0, 100);
}

/** Hours until the battery reaches its limit at the present set-point, or null if idle. */
export function batteryHoursLeft(b: Battery): number | null {
  const p = batteryPower(b);
  if (p === 0) return null;
  const energy = (b.soc / 100) * b.energyCap;
  if (p > 0) return ((energy - (PLANT.batterySocMin.value / 100) * b.energyCap) * oneWay()) / p;
  return ((PLANT.batterySocMax.value / 100) * b.energyCap - energy) / (-p * oneWay());
}
