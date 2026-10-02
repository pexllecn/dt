/**
 * IEC 60076-7 difference-equation thermal model (top-oil and winding hot-spot), with
 * automatic cooling stages switched on winding temperature, forced cooling, cooling-pump failure and relative ageing.
 *
 *   top-oil:   dθo   = dt / (k11·τo) · [ Δθor·((1 + R·K²)/(1 + R))^x − (θo − θa) ]
 *   hot-spot:  dΔθh1 = dt / (k22·τw) · [ k21·Hgr·K^y − Δθh1 ]
 *              dΔθh2 = dt / (τo/k22) · [ (k21 − 1)·Hgr·K^y − Δθh2 ]
 *              θh = θo + Δθh1 − Δθh2
 *
 * K is the load in per unit of what the present cooling mode can carry.
 */
import { THERMAL, type ThermalSet } from '../../config/assumptions.ts';
import type { CoolingStage, Transformer } from '../types.ts';

export interface CoolingMode {
  set: ThermalSet;
  /** Fraction of nameplate this mode can carry continuously. */
  capacity: number;
  label: string;
}

/** The plant's actual cooling mode, including any failure. */
export function coolingMode(tx: Pick<Transformer, 'coolingType' | 'pumpFailed' | 'stage'>, assumeHealthy = false): CoolingMode {
  if (tx.coolingType === 'OFAF') {
    if (tx.pumpFailed && !assumeHealthy) {
      return { set: THERMAL.ONAN.value, capacity: THERMAL.pumpFailedCapacity.value, label: 'Oil pumps failed' };
    }
    const cap = THERMAL.ofStageCapacity.value[tx.stage];
    return { set: THERMAL.OF.value, capacity: cap, label: tx.stage === 0 ? 'OFAN' : `OFAF stage ${tx.stage}` };
  }
  const cap = THERMAL.onafStageCapacity.value[tx.stage];
  return tx.stage === 0
    ? { set: THERMAL.ONAN.value, capacity: cap, label: 'ONAN' }
    : { set: THERMAL.ONAF.value, capacity: cap, label: `ONAF stage ${tx.stage}` };
}

/** Automatic fan control on winding (hot-spot) temperature, with hysteresis. Forced cooling runs everything. */
export function nextStage(current: CoolingStage, hotSpot: number, forced: boolean, energised: boolean): CoolingStage {
  if (!energised) return 0;
  if (forced) return 2;
  const T = THERMAL;
  let s = current;
  if (s === 0 && hotSpot >= T.fanStage1On.value) s = 1;
  if (s === 1 && hotSpot >= T.fanStage2On.value) s = 2;
  if (s === 2 && hotSpot < T.fanStage2Off.value) s = 1;
  if (s === 1 && hotSpot < T.fanStage1Off.value) s = 0;
  return s;
}

export interface ThermalState {
  topOil: number;
  dh1: number;
  dh2: number;
}

/** Advance one step. `loadPU` is per unit of nameplate. Returns the new state and hot-spot. */
export function iecStep(s: ThermalState, mode: CoolingMode, loadPU: number, energised: boolean, ambient: number, dtS: number): ThermalState & { hotSpot: number } {
  const p = mode.set;
  const R = THERMAL.lossRatio.value;
  const K = loadPU / mode.capacity;
  const oilUlt = energised ? p.topOilRiseK * Math.pow((1 + R * K * K) / (1 + R), p.x) : 0;
  const grad = energised ? p.hotSpotGradientK * Math.pow(K, p.y) : 0;
  const tauO = p.tauOilMin * 60;
  const tauW = p.tauWindingMin * 60;
  const topOil = s.topOil + (dtS / (p.k11 * tauO)) * (oilUlt - (s.topOil - ambient));
  const dh1 = s.dh1 + (dtS / (p.k22 * tauW)) * (p.k21 * grad - s.dh1);
  const dh2 = s.dh2 + (dtS / (tauO / p.k22)) * ((p.k21 - 1) * grad - s.dh2);
  return { topOil, dh1, dh2, hotSpot: topOil + dh1 - dh2 };
}

/** Steady-state temperatures for a constant load (the limit of iecStep). */
export function steadyState(mode: CoolingMode, loadPU: number, ambient: number): { topOil: number; hotSpot: number } {
  const p = mode.set;
  const R = THERMAL.lossRatio.value;
  const K = loadPU / mode.capacity;
  const topOil = ambient + p.topOilRiseK * Math.pow((1 + R * K * K) / (1 + R), p.x);
  return { topOil, hotSpot: topOil + p.hotSpotGradientK * Math.pow(K, p.y) };
}

/** Relative ageing rate V = 2^((θh − 98)/6) for non-thermally upgraded paper. */
export function ageingRate(hotSpot: number): number {
  return Math.pow(2, (hotSpot - THERMAL.ageingReferenceC.value) / THERMAL.ageingDoublingK.value);
}

/** Ambient temperature for a time of day (s since midnight): mean plus a daily swing peaking at 15:00. */
export function ambientAt(tOfDay: number): number {
  const h = tOfDay / 3600;
  return THERMAL.ambientMeanC.value + THERMAL.ambientSwingC.value * Math.cos(((h - 15) / 24) * 2 * Math.PI);
}
