import { byThreshold, defineRules, type AssetType, type Rule } from '../types';
import type {
  BatteryInput,
  CoordinatorInput,
  InterconnectorInput,
  LargeLoadInput,
  SubstationInput,
  WindFarmInput,
} from '../inputs';

type R<I> = Omit<Rule<I>, 'assetType' | 'version' | 'condition'> & { version?: string; condition?: Rule<I>['condition'] };
function rules<I>(type: AssetType, list: R<I>[]) {
  return defineRules<I>(
    type,
    list.map((r) => ({ version: '1.0.0', ...r, condition: r.condition ?? byThreshold(r.measure, r.threshold.op) })),
  );
}

// ------------------------------------------------------------------ substations
const sub: SubstationInput = {
  kv: 110,
  circuits: 4,
  circuitsOut: 0,
  maxBranchLoading: 0.5,
  maxN1Loading: 0.7,
  protectionHealthy: true,
  batteryChargerOk: true,
  commsOk: true,
  securityAlarm: false,
  stale: false,
};
const s = (p: Partial<SubstationInput>) => ({ ...sub, ...p });

export const substationRules = rules<SubstationInput>('substation', [
  { id: 'SUB-B-001', maturity: 'base', severity: 'warning', description: 'One or more connected circuits out of service.', inputs: ['circuitsOut'], measure: (i) => i.circuitsOut, threshold: { value: 1, unit: 'circuits', source: 'Synthetic', op: '>=' }, action: 'publish', outcome: 'Station running with reduced redundancy.', examples: { fires: [s({ circuitsOut: 1 })], quiet: [s({})] } },
  { id: 'SUB-B-002', maturity: 'base', severity: 'critical', description: 'A connected circuit is above its rating.', inputs: ['maxBranchLoading'], measure: (i) => i.maxBranchLoading * 100, threshold: { value: 100, unit: '%', source: 'Assumption', op: '>' }, action: 'alarm', outcome: 'Station overload alarm.', examples: { fires: [s({ maxBranchLoading: 1.1 })], quiet: [s({})] } },
  { id: 'SUB-B-003', maturity: 'base', severity: 'critical', description: 'Protection system unhealthy.', inputs: ['protectionHealthy'], measure: (i) => (i.protectionHealthy ? 0 : 1), threshold: { value: 1, unit: '', source: 'Synthetic', op: '>=' }, action: 'alarm', outcome: 'Protection engineer called out.', examples: { fires: [s({ protectionHealthy: false })], quiet: [s({})] } },
  { id: 'SUB-B-004', maturity: 'base', severity: 'warning', description: 'Communications to the station lost.', inputs: ['commsOk'], measure: (i) => (i.commsOk ? 0 : 1), threshold: { value: 1, unit: '', source: 'Synthetic', op: '>=' }, action: 'localSafeMode', outcome: 'Local safe rules applied; state marked stale.', examples: { fires: [s({ commsOk: false })], quiet: [s({})] } },
  { id: 'SUB-B-005', maturity: 'base', severity: 'warning', description: 'A connected circuit would exceed its rating under N-1.', inputs: ['maxN1Loading'], measure: (i) => i.maxN1Loading * 100, threshold: { value: 100, unit: '%', source: 'Assumption', op: '>' }, action: 'publish', outcome: 'N-1 exposure at this station published.', examples: { fires: [s({ maxN1Loading: 1.05 })], quiet: [s({})] } },
  { id: 'SUB-E-001', maturity: 'extended', severity: 'critical', description: 'Two or more circuits out of service at once.', inputs: ['circuitsOut'], measure: (i) => i.circuitsOut, threshold: { value: 2, unit: 'circuits', source: 'Synthetic', op: '>=' }, action: 'alarm', outcome: 'Station at N-2: restoration priority raised.', examples: { fires: [s({ circuitsOut: 2 })], quiet: [s({ circuitsOut: 1 })] } },
  { id: 'SUB-E-002', maturity: 'extended', severity: 'warning', description: 'DC battery charger fault (protection supply at risk).', inputs: ['batteryChargerOk'], measure: (i) => (i.batteryChargerOk ? 0 : 1), threshold: { value: 1, unit: '', source: 'Synthetic', op: '>=' }, action: 'alarm', outcome: 'Charger repair before batteries deplete.', examples: { fires: [s({ batteryChargerOk: false })], quiet: [s({})] } },
  { id: 'SUB-E-003', maturity: 'extended', severity: 'advisory', description: 'Security alarm at the perimeter.', inputs: ['securityAlarm'], measure: (i) => (i.securityAlarm ? 1 : 0), threshold: { value: 1, unit: '', source: 'Synthetic', op: '>=' }, action: 'publish', outcome: 'Security team notified.', examples: { fires: [s({ securityAlarm: true })], quiet: [s({})] } },
  { id: 'SUB-E-004', maturity: 'extended', severity: 'warning', description: 'Communications lost while a circuit is above 80%.', inputs: ['commsOk', 'maxBranchLoading'], measure: (i) => (i.commsOk ? 0 : i.maxBranchLoading * 100), threshold: { value: 80, unit: '%', source: 'Assumption', op: '>' }, action: 'localSafeMode', outcome: 'Local overload protection relied on; coordinator withholds remote actions here.', examples: { fires: [s({ commsOk: false, maxBranchLoading: 0.9 })], quiet: [s({ commsOk: false, maxBranchLoading: 0.4 })] } },
]);

// ------------------------------------------------------------------ wind farms
const wf: WindFarmInput = { capacityMW: 100, mw: 40, availableMW: 40, curtailedShare: 0, windMs: 9, cutOutMs: 25, exportLoading: 0.5, turbinesAvailable: 0.97, stale: false };
const w = (p: Partial<WindFarmInput>) => ({ ...wf, ...p });

export const windRules = rules<WindFarmInput>('windfarm', [
  { id: 'WF-B-001', maturity: 'base', severity: 'warning', description: 'Wind above the cut-out speed: turbines shutting down.', inputs: ['windMs', 'cutOutMs'], measure: (i) => i.windMs - i.cutOutMs, threshold: { value: 0, unit: 'm/s over cut-out', source: 'Assumption', op: '>=' }, action: 'publish', outcome: 'Loss of output published to the coordinator.', examples: { fires: [w({ windMs: 27 })], quiet: [w({ windMs: 15 })] } },
  { id: 'WF-B-002', maturity: 'base', severity: 'info', description: 'Output being curtailed.', inputs: ['curtailedShare'], measure: (i) => i.curtailedShare * 100, threshold: { value: 5, unit: '%', source: 'Synthetic', op: '>' }, action: 'publish', outcome: 'Curtailment logged.', examples: { fires: [w({ curtailedShare: 0.2 })], quiet: [w({})] } },
  { id: 'WF-B-003', maturity: 'base', severity: 'warning', description: 'Export circuit above 90%.', inputs: ['exportLoading'], measure: (i) => i.exportLoading * 100, threshold: { value: 90, unit: '%', source: 'Assumption', op: '>' }, action: 'publish', outcome: 'Export constraint likely; ready to reduce output on instruction.', examples: { fires: [w({ exportLoading: 0.95 })], quiet: [w({})] } },
  { id: 'WF-B-004', maturity: 'base', severity: 'advisory', description: 'Turbine availability below 90%.', inputs: ['turbinesAvailable'], measure: (i) => i.turbinesAvailable * 100, threshold: { value: 90, unit: '%', source: 'Synthetic', op: '<' }, action: 'publish', outcome: 'Maintenance status published.', examples: { fires: [w({ turbinesAvailable: 0.8 })], quiet: [w({})] } },
  { id: 'WF-B-005', maturity: 'base', severity: 'info', description: 'Generating above 80% of capacity.', inputs: ['mw', 'capacityMW'], measure: (i) => (100 * i.mw) / Math.max(1, i.capacityMW), threshold: { value: 80, unit: '%', source: 'Synthetic', op: '>' }, action: 'publish', outcome: 'High output published.', examples: { fires: [w({ mw: 90 })], quiet: [w({})] } },
  { id: 'WF-E-001', maturity: 'extended', severity: 'warning', description: 'Wind within 3 m/s of cut-out: risk of a sudden loss of output.', inputs: ['windMs', 'cutOutMs'], measure: (i) => i.cutOutMs - i.windMs, threshold: { value: 3, unit: 'm/s below cut-out', source: 'Assumption', op: '<=' }, condition: (i, t) => i.windMs < i.cutOutMs && i.cutOutMs - i.windMs <= t, action: 'publish', outcome: 'Reserve holding advised to the coordinator.', examples: { fires: [w({ windMs: 23 })], quiet: [w({ windMs: 12 })] } },
  { id: 'WF-E-002', maturity: 'extended', severity: 'info', description: 'Curtailed while the local export circuit has headroom: a system-wide (SNSP) limit, not a local constraint.', inputs: ['curtailedShare', 'exportLoading'], measure: (i) => (i.exportLoading < 0.7 ? i.curtailedShare * 100 : 0), threshold: { value: 5, unit: '%', source: 'Synthetic', op: '>' }, action: 'publish', outcome: 'Curtailment classified as system, not constraint.', examples: { fires: [w({ curtailedShare: 0.2, exportLoading: 0.5 })], quiet: [w({ curtailedShare: 0.2, exportLoading: 0.9 })] } },
  { id: 'WF-E-003', maturity: 'extended', severity: 'info', description: 'Curtailed while the local export circuit is constrained: a network constraint.', inputs: ['curtailedShare', 'exportLoading'], measure: (i) => (i.exportLoading >= 0.9 ? i.curtailedShare * 100 : 0), threshold: { value: 5, unit: '%', source: 'Synthetic', op: '>' }, action: 'publish', outcome: 'Curtailment classified as constraint.', examples: { fires: [w({ curtailedShare: 0.2, exportLoading: 0.95 })], quiet: [w({ curtailedShare: 0.2, exportLoading: 0.5 })] } },
  { id: 'WF-E-004', maturity: 'extended', severity: 'info', description: 'Telemetry stale: holding last setpoint.', inputs: ['stale'], measure: (i) => (i.stale ? 1 : 0), threshold: { value: 1, unit: '', source: 'Synthetic', op: '>=' }, action: 'localSafeMode', outcome: 'Wind farm holds its last setpoint and local frequency response.', examples: { fires: [w({ stale: true })], quiet: [w({})] } },
]);

// ------------------------------------------------------------------ batteries
const bt: BatteryInput = { capacityMW: 50, energyMWh: 50, soc: 0.6, mw: 0, cellTempC: 25, cyclesToday: 0.5, corridorN1: 0.7, stale: false };
const b = (p: Partial<BatteryInput>) => ({ ...bt, ...p });

export const batteryRules = rules<BatteryInput>('battery', [
  { id: 'BAT-B-001', maturity: 'base', severity: 'advisory', description: 'State of charge below 20%.', inputs: ['soc'], measure: (i) => i.soc * 100, threshold: { value: 20, unit: '%', source: 'Synthetic', op: '<' }, action: 'publish', outcome: 'Limited discharge capability published.', examples: { fires: [b({ soc: 0.1 })], quiet: [b({})] } },
  { id: 'BAT-B-002', maturity: 'base', severity: 'info', description: 'State of charge above 90%.', inputs: ['soc'], measure: (i) => i.soc * 100, threshold: { value: 90, unit: '%', source: 'Synthetic', op: '>' }, action: 'publish', outcome: 'Full discharge capability available.', examples: { fires: [b({ soc: 0.95 })], quiet: [b({})] } },
  { id: 'BAT-B-003', maturity: 'base', severity: 'warning', description: 'Cell temperature above 40 °C.', inputs: ['cellTempC'], measure: (i) => i.cellTempC, threshold: { value: 40, unit: '°C', source: 'Assumption', op: '>' }, action: 'alarm', outcome: 'Power derated by the site controller.', examples: { fires: [b({ cellTempC: 45 })], quiet: [b({})] } },
  { id: 'BAT-B-004', maturity: 'base', severity: 'info', description: 'Discharging into the grid.', inputs: ['mw'], measure: (i) => i.mw, threshold: { value: 1, unit: 'MW', source: 'Synthetic', op: '>' }, action: 'publish', outcome: 'Discharge published.', examples: { fires: [b({ mw: 20 })], quiet: [b({ mw: -10 })] } },
  { id: 'BAT-B-005', maturity: 'base', severity: 'info', description: 'Charging from the grid.', inputs: ['mw'], measure: (i) => i.mw, threshold: { value: -1, unit: 'MW', source: 'Synthetic', op: '<' }, action: 'publish', outcome: 'Charging published.', examples: { fires: [b({ mw: -20 })], quiet: [b({ mw: 5 })] } },
  { id: 'BAT-E-001', maturity: 'extended', severity: 'advisory', description: 'More than 1.5 full cycles today: degradation budget exceeded.', inputs: ['cyclesToday'], measure: (i) => i.cyclesToday, threshold: { value: 1.5, unit: 'cycles', source: 'Assumption', op: '>' }, action: 'publish', outcome: 'Cycling caution published.', examples: { fires: [b({ cyclesToday: 2 })], quiet: [b({})] } },
  { id: 'BAT-E-002', maturity: 'extended', severity: 'warning', description: 'Corridor N-1 exposure above 100% and charge available: discharge can relieve it.', inputs: ['corridorN1', 'soc'], measure: (i) => (i.soc > 0.3 ? i.corridorN1 * 100 : 0), threshold: { value: 100, unit: '%', source: 'Assumption', op: '>' }, action: 'recommend', outcome: 'Offered to the coordinator for corrective discharge.', examples: { fires: [b({ corridorN1: 1.1, soc: 0.7 })], quiet: [b({ corridorN1: 1.1, soc: 0.1 })] } },
  { id: 'BAT-E-003', maturity: 'extended', severity: 'info', description: 'Telemetry stale: holding reserve.', inputs: ['stale'], measure: (i) => (i.stale ? 1 : 0), threshold: { value: 1, unit: '', source: 'Synthetic', op: '>=' }, action: 'localSafeMode', outcome: 'Battery holds 50% charge in reserve and responds to local frequency only.', examples: { fires: [b({ stale: true })], quiet: [b({})] } },
]);

// ------------------------------------------------------------------ large loads
const ll: LargeLoadInput = { mw: 40, contractedMW: 50, firmMW: 50, flexibleMW: 0, feedN1: 0.7, backupFuelHours: 48, hypothetical: false, stale: false };
const l = (p: Partial<LargeLoadInput>) => ({ ...ll, ...p });

export const largeLoadRules = rules<LargeLoadInput>('largeload', [
  { id: 'LL-B-001', maturity: 'base', severity: 'warning', description: 'Demand above contracted capacity.', inputs: ['mw', 'contractedMW'], measure: (i) => i.mw - i.contractedMW, threshold: { value: 0, unit: 'MW over contract', source: 'Synthetic', op: '>' }, action: 'publish', outcome: 'Exceedance reported.', examples: { fires: [l({ mw: 55 })], quiet: [l({})] } },
  { id: 'LL-B-002', maturity: 'base', severity: 'warning', description: 'Feeding circuits exposed above 100% under N-1.', inputs: ['feedN1'], measure: (i) => i.feedN1 * 100, threshold: { value: 100, unit: '%', source: 'Assumption', op: '>' }, action: 'publish', outcome: 'Site exposure published; flexible demand on standby.', examples: { fires: [l({ feedN1: 1.1 })], quiet: [l({})] } },
  { id: 'LL-B-003', maturity: 'base', severity: 'info', description: 'Demand above firm capacity: the non-firm part is interruptible.', inputs: ['mw', 'firmMW'], measure: (i) => i.mw - i.firmMW, threshold: { value: 0, unit: 'MW above firm', source: 'Synthetic', op: '>' }, action: 'publish', outcome: 'Non-firm demand flagged.', examples: { fires: [l({ mw: 45, firmMW: 30 })], quiet: [l({})] } },
  { id: 'LL-B-004', maturity: 'base', severity: 'advisory', description: 'Backup fuel below 24 hours.', inputs: ['backupFuelHours'], measure: (i) => i.backupFuelHours, threshold: { value: 24, unit: 'h', source: 'Synthetic', op: '<' }, action: 'publish', outcome: 'Fuel delivery requested.', examples: { fires: [l({ backupFuelHours: 12 })], quiet: [l({})] } },
  { id: 'LL-B-005', maturity: 'base', severity: 'info', description: 'Telemetry stale.', inputs: ['stale'], measure: (i) => (i.stale ? 1 : 0), threshold: { value: 1, unit: '', source: 'Synthetic', op: '>=' }, action: 'localSafeMode', outcome: 'Site holds its last schedule.', examples: { fires: [l({ stale: true })], quiet: [l({})] } },
  { id: 'LL-E-001', maturity: 'extended', severity: 'warning', description: 'Feed exposed above 100% under N-1 and flexible demand available: reduce now.', inputs: ['feedN1', 'flexibleMW'], measure: (i) => (i.flexibleMW > 0 ? i.feedN1 * 100 : 0), threshold: { value: 100, unit: '%', source: 'Assumption', op: '>' }, action: 'recommend', outcome: 'Flexible demand reduction offered to the coordinator.', examples: { fires: [l({ feedN1: 1.1, flexibleMW: 15 })], quiet: [l({ feedN1: 1.1 })] } },
]);

// ------------------------------------------------------------------ interconnectors
const ic: InterconnectorInput = { mw: 100, capacityMW: 500, scheduleMW: 100, stationN1: 0.6, snsp: 0.5, snspCap: 0.75, stale: false };
const c = (p: Partial<InterconnectorInput>) => ({ ...ic, ...p });

export const interconnectorRules = rules<InterconnectorInput>('interconnector', [
  { id: 'IC-B-001', maturity: 'base', severity: 'info', description: 'Importing above 80% of capacity.', inputs: ['mw', 'capacityMW'], measure: (i) => (100 * i.mw) / i.capacityMW, threshold: { value: 80, unit: '%', source: 'Synthetic', op: '>' }, action: 'publish', outcome: 'High import published.', examples: { fires: [c({ mw: 450 })], quiet: [c({})] } },
  { id: 'IC-B-002', maturity: 'base', severity: 'info', description: 'Exporting above 80% of capacity.', inputs: ['mw', 'capacityMW'], measure: (i) => (-100 * i.mw) / i.capacityMW, threshold: { value: 80, unit: '%', source: 'Synthetic', op: '>' }, action: 'publish', outcome: 'High export published.', examples: { fires: [c({ mw: -450 })], quiet: [c({})] } },
  { id: 'IC-B-003', maturity: 'base', severity: 'warning', description: 'Converter station exposed above 100% under N-1.', inputs: ['stationN1'], measure: (i) => i.stationN1 * 100, threshold: { value: 100, unit: '%', source: 'Assumption', op: '>' }, action: 'publish', outcome: 'Schedule review suggested.', examples: { fires: [c({ stationN1: 1.1 })], quiet: [c({})] } },
  { id: 'IC-B-004', maturity: 'base', severity: 'advisory', description: 'Imports pushing SNSP within 3 points of the cap.', inputs: ['snsp', 'snspCap'], measure: (i) => (i.snspCap - i.snsp) * 100, threshold: { value: 3, unit: 'points below cap', source: 'Assumption', op: '<' }, condition: (i, t) => i.mw > 0 && (i.snspCap - i.snsp) * 100 < t, action: 'publish', outcome: 'Import headroom limited by SNSP.', examples: { fires: [c({ snsp: 0.74, mw: 300 })], quiet: [c({ snsp: 0.5 })] } },
  { id: 'IC-B-005', maturity: 'base', severity: 'info', description: 'Telemetry stale.', inputs: ['stale'], measure: (i) => (i.stale ? 1 : 0), threshold: { value: 1, unit: '', source: 'Synthetic', op: '>=' }, action: 'localSafeMode', outcome: 'Converter holds its schedule.', examples: { fires: [c({ stale: true })], quiet: [c({})] } },
  { id: 'IC-E-001', maturity: 'extended', severity: 'advisory', description: 'Flow differs from schedule by more than 10% of capacity.', inputs: ['mw', 'scheduleMW', 'capacityMW'], measure: (i) => (100 * Math.abs(i.mw - i.scheduleMW)) / i.capacityMW, threshold: { value: 10, unit: '% of capacity', source: 'Synthetic', op: '>' }, action: 'publish', outcome: 'Schedule deviation reported.', examples: { fires: [c({ mw: 200, scheduleMW: 100 })], quiet: [c({})] } },
]);

// ------------------------------------------------------------------ coordinator
const co: CoordinatorInput = { overloadsN: 0, overloadsN1: 0, worstN1: 0.8, snsp: 0.5, snspCap: 0.75, curtailedMW: 0, staleShare: 0, unservedMW: 0 };
const k = (p: Partial<CoordinatorInput>) => ({ ...co, ...p });

export const coordinatorRules = rules<CoordinatorInput>('coordinator', [
  { id: 'COORD-001', maturity: 'base', severity: 'critical', description: 'One or more circuits overloaded now: propose corrective re-dispatch.', inputs: ['overloadsN'], measure: (i) => i.overloadsN, threshold: { value: 1, unit: 'circuits', source: 'Synthetic', op: '>=' }, action: 'recommend', outcome: 'Re-dispatch proposal prepared for approval (METHOD-REDISPATCH-01).', examples: { fires: [k({ overloadsN: 2 })], quiet: [k({})] } },
  { id: 'COORD-002', maturity: 'base', severity: 'warning', description: 'Circuits exposed above 100% under N-1: consider preventive action.', inputs: ['overloadsN1', 'worstN1'], measure: (i) => i.overloadsN1, threshold: { value: 1, unit: 'circuits', source: 'Synthetic', op: '>=' }, action: 'publish', outcome: 'N-1 exposure summarised for the operator.', examples: { fires: [k({ overloadsN1: 3 })], quiet: [k({})] } },
  { id: 'COORD-003', maturity: 'base', severity: 'info', description: 'Renewable output curtailed to respect the SNSP cap.', inputs: ['curtailedMW', 'snsp'], measure: (i) => i.curtailedMW, threshold: { value: 10, unit: 'MW', source: 'Synthetic', op: '>' }, action: 'publish', outcome: 'System curtailment logged.', examples: { fires: [k({ curtailedMW: 120 })], quiet: [k({})] } },
  { id: 'COORD-004', maturity: 'base', severity: 'warning', description: 'More than 10% of inputs stale: recommendations carry reduced confidence.', inputs: ['staleShare'], measure: (i) => i.staleShare * 100, threshold: { value: 10, unit: '% of inputs', source: 'Synthetic', op: '>' }, action: 'publish', outcome: 'Confidence reduced; actions on stale assets withheld (consistency preferred).', examples: { fires: [k({ staleShare: 0.2 })], quiet: [k({})] } },
  { id: 'COORD-005', maturity: 'base', severity: 'critical', description: 'Demand not met by available generation.', inputs: ['unservedMW'], measure: (i) => i.unservedMW, threshold: { value: 1, unit: 'MW', source: 'Synthetic', op: '>' }, action: 'alarm', outcome: 'Emergency procedures advised.', examples: { fires: [k({ unservedMW: 50 })], quiet: [k({})] } },
]);
