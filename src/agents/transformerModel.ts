/**
 * Transformer thermal model and dissolved gas interpretation.
 *
 * Thermal: IEC 60076-7 steady-state equations, typical ONAF parameters
 *   top oil  θo = θa + Δθor · ((1 + R K²) / (1 + R))^x
 *   hot spot θh = θo + Hgr · K^y
 *   ageing   V  = 2^((θh − 98) / 6)        (non-thermally upgraded paper)
 * K = load factor (load / rated). Parameters are the standard's typical values (Assumption).
 *
 * Gas: Duval triangle 1 (IEC 60599 annex) on CH4, C2H4, C2H2.
 */
export const thermalParams = { deltaTopOilRated: 45, hotSpotGradient: 26, R: 6, x: 0.8, y: 1.3 };

export function topOil(ambientC: number, K: number): number {
  const { deltaTopOilRated, R, x } = thermalParams;
  return ambientC + deltaTopOilRated * ((1 + R * K * K) / (1 + R)) ** x;
}

export function hotSpot(ambientC: number, K: number): number {
  return topOil(ambientC, K) + thermalParams.hotSpotGradient * K ** thermalParams.y;
}

export function ageingRate(hotSpotC: number): number {
  return 2 ** ((hotSpotC - 98) / 6);
}

export type DuvalZone = 'PD' | 'T1' | 'T2' | 'T3' | 'D1' | 'D2' | 'DT' | 'none';

/** Duval triangle 1 zone from methane, ethylene and acetylene (ppm). */
export function duval(ch4: number, c2h4: number, c2h2: number): DuvalZone {
  const total = ch4 + c2h4 + c2h2;
  if (total < 1) return 'none';
  const m = (100 * ch4) / total;
  const e = (100 * c2h4) / total;
  const a = (100 * c2h2) / total;
  if (m >= 98) return 'PD';
  if (a < 4 && e < 20) return 'T1';
  if (a < 4 && e >= 20 && e < 50) return 'T2';
  if (a < 15 && e >= 50) return 'T3';
  if (e < 23 && a >= 13) return 'D1';
  if (a >= 13 && a < 29 && e >= 23 && e < 40) return 'D2';
  if (a >= 29 && e >= 23) return 'D2';
  return 'DT';
}

export const duvalCode: Record<DuvalZone, number> = { none: 0, PD: 1, T1: 2, T2: 3, T3: 4, DT: 5, D1: 6, D2: 7 };
export const duvalName: Record<DuvalZone, string> = {
  none: 'no fault indicated',
  PD: 'partial discharge',
  T1: 'thermal fault below 300 °C',
  T2: 'thermal fault 300 to 700 °C',
  T3: 'thermal fault above 700 °C',
  DT: 'mixed thermal and electrical',
  D1: 'low-energy discharge',
  D2: 'high-energy discharge',
};
