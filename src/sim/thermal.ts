import { conductorPhysics as cp, conductors, type ConductorClass } from '@/config/network';

/**
 * Conductor temperature, sag and blow-out. A simplified steady-state heat balance in the
 * spirit of IEEE 738: Joule heating rises with the square of current; convective cooling
 * grows with roughly the square root of wind speed. The static rating is the current at which
 * the conductor reaches its maximum design temperature at the rating ambient and wind.
 */
export function conductorClass(kv: number): ConductorClass {
  const keys = Object.keys(conductors).map(Number);
  const k = keys.reduce((best, v) => (Math.abs(v - kv) < Math.abs(best - kv) ? v : best), keys[0]!);
  return conductors[k]!;
}

/** Steady-state conductor temperature (°C) at a loading (current / static rating). */
export function conductorTemperature(kv: number, loading: number, ambientC: number, windMs: number): number {
  const c = conductorClass(kv);
  const riseAtRating = c.maxDesignTempC.value - cp.ratingAmbientC.value;
  const cooling = Math.sqrt(Math.max(windMs, cp.ratingWindMs.value) / cp.ratingWindMs.value);
  return ambientC + (riseAtRating * loading * loading) / cooling;
}

/**
 * Mid-span sag (m) at a conductor temperature, from thermal elongation of the conductor:
 * length S = L + 8D²/3L (parabolic approximation), S(T) = S(Tmax) (1 + α (T − Tmax)).
 * Elastic stretch and creep are ignored, which slightly overstates the change.
 */
export function sagAt(kv: number, tempC: number, span?: number): number {
  const c = conductorClass(kv);
  const L = span ?? c.rulingSpanM.value;
  const scale = (L / c.rulingSpanM.value) ** 2; // sag grows with the square of the span
  const Dd = c.sagAtDesignM.value * scale;
  const Sd = L + (8 * Dd * Dd) / (3 * L);
  const S = Sd * (1 + cp.expansionPerC.value * (tempC - c.maxDesignTempC.value));
  return Math.sqrt(Math.max(0, (3 * L * (S - L)) / 8));
}

/** Swing angle (radians) of the conductor out of the vertical plane in a cross wind. */
export function blowoutAngle(kv: number, windMs: number): number {
  const c = conductorClass(kv);
  const q = 0.5 * cp.airDensity.value * windMs * windMs * cp.dragCoefficient.value * (c.diameterMm.value / 1000);
  const w = c.massKgPerM.value * 9.81;
  return Math.atan2(q, w);
}
