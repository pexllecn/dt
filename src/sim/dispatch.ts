import { operation } from '@/config/system';
import type { Model } from './model';

/**
 * Economic dispatch for one interval, without network constraints (that is the market
 * schedule; network constraints are found afterwards and are the agents' job).
 *   1. Interconnector schedules are inputs.
 *   2. The cheapest large synchronous units are committed at minimum stable generation until
 *      the minimum-units constraint is met.
 *   3. Wind and solar are dispatched up to the lesser of what is available, what demand leaves
 *      room for, and the SNSP cap. The rest is curtailment (system-wide, pro rata).
 *   4. Remaining demand is met in merit order by committed units, then further units.
 */
export interface DispatchInput {
  demandMW: number; // all-island, including losses
  windAvailMW: number;
  solarAvailMW: number;
  icImportMW: number; // net import, all interconnectors (negative = export)
  batteryMW: number; // positive = discharging into the grid, negative = charging
  unitAvailable: (unitIdx: number) => boolean;
  snspCap?: number;
  minUnits?: number;
}

export interface DispatchResult {
  unitMW: Float64Array;
  windMW: number;
  solarMW: number;
  curtailedMW: number;
  snsp: number;
  committed: number[];
  unserved: number;
  /** Which rule limited renewables: 'none' | 'snsp' | 'demand'. */
  limit: 'none' | 'snsp' | 'demand';
}

export function dispatch(model: Model, input: DispatchInput): DispatchResult {
  const cap = input.snspCap ?? operation.snspCap.value;
  const minUnits = input.minUnits ?? operation.minUnits.value;
  const unitMW = new Float64Array(model.units.length);
  const order = model.units
    .filter((u) => input.unitAvailable(u.idx))
    .sort((a, b) => a.spec.cost - b.spec.cost || a.idx - b.idx);

  const committed: number[] = [];
  let mustRun = 0;
  for (const u of order) {
    if (committed.length >= minUnits) break;
    if (!u.spec.large) continue;
    committed.push(u.idx);
    unitMW[u.idx] = u.min;
    mustRun += u.min;
  }

  const imp = Math.max(0, input.icImportMW);
  const exp = Math.max(0, -input.icImportMW);
  const battery = input.batteryMW;
  // Non-synchronous share: wind + solar + HVDC imports (+ battery discharge) over demand + exports.
  const snspRoom = cap * (input.demandMW + exp + Math.max(0, -battery)) - imp - Math.max(0, battery);
  const demandRoom = input.demandMW + exp - imp - battery - mustRun;
  const avail = input.windAvailMW + input.solarAvailMW;
  let renew = Math.max(0, Math.min(avail, snspRoom, demandRoom));
  let limit: DispatchResult['limit'] = 'none';
  if (renew < avail - 1e-6) limit = snspRoom < demandRoom ? 'snsp' : 'demand';

  let remaining = input.demandMW + exp - imp - battery - mustRun - renew;
  // Raise committed units, cheapest first.
  for (const idx of committed) {
    if (remaining <= 0) break;
    const u = model.units[idx]!;
    const add = Math.min(u.capacity - unitMW[idx]!, remaining);
    unitMW[idx] = unitMW[idx]! + add;
    remaining -= add;
  }
  // Commit further units in merit order.
  for (const u of order) {
    if (remaining <= 1e-6) break;
    if (committed.includes(u.idx)) continue;
    const take = Math.min(u.capacity, Math.max(remaining, u.min));
    unitMW[u.idx] = take;
    committed.push(u.idx);
    remaining -= take;
  }
  // If minimum stable generation overshoots, back off the last committed flexible units.
  if (remaining < 0) {
    for (let i = committed.length - 1; i >= 0 && remaining < -1e-6; i--) {
      const idx = committed[i]!;
      const u = model.units[idx]!;
      const reducible = unitMW[idx]! - u.min;
      const cut = Math.min(reducible, -remaining);
      unitMW[idx] = unitMW[idx]! - cut;
      remaining += cut;
    }
    if (remaining < -1e-6) {
      // still over: curtail renewables further
      const cut = Math.min(renew, -remaining);
      renew -= cut;
      remaining += cut;
      limit = 'demand';
    }
  }
  const nonSync = renew + imp + Math.max(0, battery);
  const snsp = nonSync / Math.max(1, input.demandMW + exp + Math.max(0, -battery));
  return {
    unitMW,
    windMW: avail > 0 ? (input.windAvailMW / avail) * renew : 0,
    solarMW: avail > 0 ? (input.solarAvailMW / avail) * renew : 0,
    curtailedMW: avail - renew,
    snsp,
    committed,
    unserved: Math.max(0, remaining),
    limit,
  };
}
