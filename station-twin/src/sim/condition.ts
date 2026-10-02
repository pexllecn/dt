/** N-1 contingency screen for the 400/220 kV units, and the station condition. */
import { LIMITS, PROTECTION } from '../config/assumptions.ts';
import { computeFlows } from './balance.ts';
import type { Condition, ContingencyResult, SimState } from './types.ts';

export function contingency(s: SimState): ContingencyResult {
  const { C } = s;
  const bothIn = C.T1.live && C.T2.live && !C.T1.tripped && !C.T2.tripped;
  if (!bothIn) return { lossOfT1: null, lossOfT2: null, worst: 0, secure: true };
  const lossOfT1 = computeFlows(C, s.sys, s.preset, ['T1']).loadPU.T2;
  const lossOfT2 = computeFlows(C, s.sys, s.preset, ['T2']).loadPU.T1;
  const worst = Math.max(lossOfT1, lossOfT2);
  return { lossOfT1, lossOfT2, worst, secure: worst <= LIMITS.n1SecureLoading.value };
}

export function stationCondition(s: SimState): Condition {
  const { C, results } = s;
  const txs = [C.T1, C.T2, C.T3, C.T4].filter((t) => t.installed);
  const demandLost =
    results.regional.offSupply > 0.5 ||
    (C.LD_NEW.installed && C.LD_NEW.closed && C.LD_NEW.mw > 0.5 && !C.LD_NEW.live) ||
    (C.LD_IND.closed && C.LD_IND.mw > 0.5 && !C.LD_IND.live);
  if (demandLost) return 'Supply lost';
  const anyTrip = [C.T1, C.T2].some((t) => t.tripped);
  const emergency = txs.some((t) => t.live && (t.loadPU > LIMITS.currentShortEmergency.value || t.temp > LIMITS.hotSpotNormalCyclic.value))
    || (anyTrip && [C.T1, C.T2].some((t) => t.live && t.loadPU > 1.0));
  if (emergency) return 'Emergency';
  if (s.programme && s.programme.status === 'running') return 'Restoring';
  const alert = txs.some((t) => t.live && (t.loadPU > 1.0 || t.temp > PROTECTION.wtiAlarm.value || t.topOil > PROTECTION.otiAlarm.value))
    || !s.contingency.secure || anyTrip || txs.some((t) => t.tripped) || s.sys.busFault.length > 0 || !s.sys.coupled;
  return alert ? 'Alert' : 'Normal';
}
