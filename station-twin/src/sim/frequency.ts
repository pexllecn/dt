/**
 * Two-area frequency model (Ireland and Northern Ireland, coupled while the border tie is in
 * service). All parameters are assumptions in config.
 *
 * Two time scales, so nothing is hidden by the compressed clock:
 *  - quasi-steady frequency on the simulation clock, after primary response, which the rest of
 *    the system restores as it follows the station's net draw with a lag;
 *  - for each sudden step, the real-time transient (swing equation with load damping and a
 *    first-order primary response), reported as an event with RoCoF and nadir.
 */
import { FREQUENCY as F } from '../config/assumptions.ts';
import { lagFactor } from '../lib/math.ts';
import type { FrequencyEvent, FrequencyState } from './types.ts';

interface Area { ek: number; r: number; d: number }
const IRL: Area = { ek: F.kineticEnergyIreland.value, r: F.responseIreland.value, d: F.dampingIreland.value };
const NI: Area = { ek: F.kineticEnergyNI.value, r: F.responseNI.value, d: F.dampingNI.value };
const ALL: Area = { ek: IRL.ek + NI.ek, r: IRL.r + NI.r, d: IRL.d + NI.d };
const f0 = () => F.nominal.value;
const beta = (a: Area) => a.r + a.d;

/** Real-time response to a step deficit (+) or surplus (-) of `deltaMw`. */
export function transient(deltaMw: number, a: Area): { series: number[]; rocof: number; nadir: number; quasiSteady: number } {
  const dt = 0.01;
  const tr = F.reserveLagS.value;
  let df = 0;
  let pr = 0;
  const series: number[] = [];
  let at500 = 0;
  let extreme = 0;
  for (let i = 0; i <= 6000; i++) {
    if (i % 10 === 0) series.push(+(f0() + df).toFixed(4));
    if (i === 50) at500 = df;
    if (Math.abs(df) > Math.abs(extreme)) extreme = df;
    const dfdt = (f0() / (2 * a.ek)) * (-deltaMw + pr - a.d * df);
    pr += (dt / tr) * (-a.r * df - pr);
    df += dfdt * dt;
  }
  return { series, rocof: at500 / 0.5, nadir: f0() + extreme, quasiSteady: f0() - deltaMw / beta(a) };
}

/** Analytic initial rate of change of frequency for a step, Hz/s (negative for a deficit). */
export const initialRocof = (deltaMw: number, ek: number) => (-deltaMw * f0()) / (2 * ek);

export const AREAS = { IRL, NI, ALL };

export function initialFrequency(drawIreland: number, drawNI: number, coupled: boolean): FrequencyState {
  return {
    coupled, ireland: f0(), ni: f0(),
    drawIreland, drawNI, coverIreland: drawIreland, coverNI: drawNI, events: [],
  };
}

/**
 * Advance one step. `drawIreland` is what the rest of Ireland must supply to Clonmore (400 kV
 * import plus requested transfers); `drawNI` is minus the transfer Northern Ireland receives.
 */
export function frequencyStep(s: FrequencyState, drawIreland: number, drawNI: number, coupled: boolean, t: number, dt: number, cause: string): void {
  const dI = drawIreland - s.drawIreland;
  const dN = drawNI - s.drawNI;
  const threshold = F.eventThresholdMw.value;
  const push = (area: FrequencyEvent['area'], delta: number, a: Area) => {
    const tr = transient(delta, a);
    s.events.push({ t, area, deltaMw: delta, cause, rocof: tr.rocof, nadir: tr.nadir, quasiSteady: tr.quasiSteady, series: tr.series });
    if (s.events.length > 8) s.events.shift();
  };
  if (coupled && s.coupled) {
    if (Math.abs(dI + dN) >= threshold) push('all-island', dI + dN, ALL);
  } else {
    if (Math.abs(dI) >= threshold) push(coupled ? 'all-island' : 'Ireland', dI, coupled ? ALL : IRL);
    if (!coupled && Math.abs(dN) >= threshold) push('Northern Ireland', dN, NI);
  }
  s.drawIreland = drawIreland;
  s.drawNI = drawNI;
  s.coupled = coupled;
  const imbI = drawIreland - s.coverIreland;
  const imbN = drawNI - s.coverNI;
  if (coupled) {
    const f = f0() - (imbI + imbN) / beta(ALL);
    s.ireland = f;
    s.ni = f;
  } else {
    s.ireland = f0() - imbI / beta(IRL);
    s.ni = f0() - imbN / beta(NI);
  }
  const k = lagFactor(dt, F.restorationTauS.value);
  s.coverIreland += (drawIreland - s.coverIreland) * k;
  s.coverNI += (drawNI - s.coverNI) * k;
}
