import { noise1 } from './prng';
import { renewables } from '@/config/system';

/**
 * Synthetic wind field. A scenario supplies a reference hub-height speed through the day
 * (and optionally a moving front); each cluster scales it by exposure (stronger to the west
 * and north, as on the Atlantic seaboard) and seeded slow turbulence.
 */
export interface WindFront {
  /** Hour at which the front crosses the west coast (easting 450 km). */
  arrivalHour: number;
  /** Eastward speed of the front in km per hour. */
  speedKmh: number;
  /** Peak speed added behind the front (m/s). */
  boost: number;
  /** Width of the band of strongest wind (km). */
  widthKm: number;
}

export interface WindScenario {
  /** Reference hub-height speed (m/s) at local hour h, before exposure. */
  reference(h: number): number;
  front?: WindFront;
  seed: number;
  /** Multiplier from the "still to gale" slider (1 = as scripted). */
  scale: number;
}

export function exposure(e: number, n: number): number {
  const west = Math.min(1, Math.max(0, (640_000 - e) / 240_000));
  const north = Math.min(1, Math.max(0, (n - 700_000) / 250_000));
  return 0.82 + 0.32 * west + 0.12 * north;
}

export function frontBoost(front: WindFront | undefined, e: number, h: number): number {
  if (!front) return 0;
  const x = (e - 450_000) / 1000 - (h - front.arrivalHour) * front.speedKmh; // km behind (+) or ahead (-) of the front line
  // Strong band just behind the front, decaying slowly behind it, nothing ahead.
  if (x < -front.widthKm) return 0;
  const g = Math.exp(-((x / front.widthKm) ** 2));
  const tail = x > 0 ? 0.55 * Math.exp(-x / (front.widthKm * 3)) : 0;
  return front.boost * Math.max(g, tail);
}

export function siteSpeed(w: WindScenario, e: number, n: number, h: number, key: number): number {
  const base = w.reference(h) * exposure(e, n) * w.scale;
  const turb = 1 + 0.14 * (noise1(w.seed + key * 7919, h / 2.5) - 0.5) * 2;
  return Math.max(0, (base + frontBoost(w.front, e, h)) * turb);
}

/** Normalised power curve: cubic from cut-in to rated, flat to cut-out, zero above. */
export function powerCurve(v: number): number {
  const ci = renewables.cutIn.value;
  const r = renewables.rated.value;
  const co = renewables.cutOut.value;
  if (v < ci || v >= co) return 0;
  if (v >= r) return 1;
  const t = (v - ci) / (r - ci);
  return t * t * (3 - 2 * t) * 0.35 + t * t * t * 0.65;
}
