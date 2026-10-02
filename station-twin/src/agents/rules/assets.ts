/**
 * Rule sets for the busbar, plant, demand, tie and infeed agents. Short by design: each reports
 * what its operator needs to know about that asset, and publishes it to its neighbours.
 */
import { PLANT, RATINGS } from '../../config/assumptions.ts';
import { assumed, typical } from '../../lib/sourced.ts';
import type { AssetType, Rule } from '../types.ts';

const mk = <I>(assetType: AssetType) => (r: Omit<Rule<I>, 'assetType' | 'maturity' | 'version'>): Rule<I> =>
  Object.freeze({ ...r, assetType, maturity: 'base', version: '1.0' });

// --- busbars ---------------------------------------------------------------------------------------
export interface BusInput { installed: boolean; energised: boolean; faulted: boolean; reenergiseBlocked: boolean; throughMW: number; ratingMW: number; affectedCircuits: number }
export const NOMINAL_BUS: BusInput = { installed: true, energised: true, faulted: false, reenergiseBlocked: false, throughMW: 300, ratingMW: 1000, affectedCircuits: 0 };
const bus = mk<BusInput>('busbar');
export const BUS_RULES: readonly Rule<BusInput>[] = Object.freeze([
  bus({ id: 'BUS-01', description: 'Busbar de-energised.', inputs: ['energised'], threshold: typical('Energised', 1, 'flag'), condition: (i) => i.installed && !i.energised && !i.faulted, action: 'publish', severity: 'warning', examples: { fires: [{ energised: false }], quiet: [{ energised: true }, { energised: false, faulted: true }] } }),
  bus({ id: 'BUS-02', description: 'Busbar fault detected: bus-zone protection operated. Circuits on this section are disconnected.', inputs: ['faulted', 'affectedCircuits'], threshold: typical('Bus-zone operated', 1, 'flag'), condition: (i) => i.faulted, action: 'alarm', severity: 'critical', examples: { fires: [{ faulted: true, affectedCircuits: 6 }], quiet: [{ faulted: false }] } }),
  bus({ id: 'BUS-03', description: 'Re-energisation blocked until a person confirms the fault is clear.', inputs: ['reenergiseBlocked'], threshold: typical('Human confirmation required', 1, 'flag'), condition: (i) => i.reenergiseBlocked, action: 'recommend', severity: 'critical', examples: { fires: [{ reenergiseBlocked: true }], quiet: [{ reenergiseBlocked: false }] } }),
  bus({ id: 'BUS-04', description: 'Through-load above 90% of the busbar rating.', inputs: ['throughMW', 'ratingMW'], threshold: assumed('Busbar loading advisory', 0.9, 'per unit'), condition: (i, th) => i.energised && i.throughMW > th * i.ratingMW, action: 'publish', severity: 'advisory', examples: { fires: [{ throughMW: 950 }], quiet: [{ throughMW: 700 }] } }),
]);
export const BUS_RATING_MW = { BUS400: assumed('400 kV busbar rating', 2000, 'MW'), BUS220A: assumed('220 kV section rating', 1000, 'MW'), BUS220B: assumed('220 kV section rating', 1000, 'MW'), BUS110: assumed('110 kV busbar rating', 400, 'MW') } as const;

// --- wind ---------------------------------------------------------------------------------------------
export interface WindInput { installed: boolean; windSpeed: number; forecastMaxWind60: number; outputMW: number; availableMW: number; dispatchedMW: number; cutOut: boolean }
export const NOMINAL_WIND: WindInput = { installed: true, windSpeed: 9, forecastMaxWind60: 10, outputMW: 160, availableMW: 160, dispatchedMW: 160, cutOut: false };
const wind = mk<WindInput>('wind');
export const WIND_RULES: readonly Rule<WindInput>[] = Object.freeze([
  wind({ id: 'WND-01', description: 'Forecast wind reaches the high-wind ramp-down within the hour: output will fall towards cut-out.', inputs: ['windSpeed', 'forecastMaxWind60'], threshold: PLANT.windStormStart, condition: (i, th) => i.installed && !i.cutOut && i.forecastMaxWind60 >= th, action: 'recommend', severity: 'warning', examples: { fires: [{ forecastMaxWind60: 25 }], quiet: [{ forecastMaxWind60: 15 }] } }),
  wind({ id: 'WND-02', description: 'Output well below what the wind supports.', inputs: ['outputMW', 'dispatchedMW', 'availableMW'], threshold: assumed('Shortfall against dispatch', 20, 'MW'), condition: (i, th) => i.installed && Math.min(i.dispatchedMW, i.availableMW) - i.outputMW > th, action: 'publish', severity: 'advisory', examples: { fires: [{ outputMW: 60, dispatchedMW: 120, availableMW: 160 }], quiet: [{ outputMW: 150 }] } }),
  wind({ id: 'WND-03', description: 'Dispatch-down active: wind available but not used.', inputs: ['dispatchedMW', 'availableMW'], threshold: assumed('Dispatch-down reported above', 10, 'MW'), condition: (i, th) => i.installed && i.availableMW - i.dispatchedMW > th, action: 'publish', severity: 'info', examples: { fires: [{ dispatchedMW: 100, availableMW: 160 }], quiet: [{ dispatchedMW: 160, availableMW: 160 }] } }),
  wind({ id: 'WND-04', description: 'Turbines cut out on high wind.', inputs: ['cutOut', 'windSpeed'], threshold: PLANT.windCutOut, condition: (i) => i.installed && i.cutOut, action: 'alarm', severity: 'warning', examples: { fires: [{ cutOut: true, windSpeed: 29 }], quiet: [{ cutOut: false }] } }),
]);

// --- battery -------------------------------------------------------------------------------------------
export interface BatteryInput { installed: boolean; soc: number; mw: number; hoursToLimit: number; reserveNeededMWh: number; energyMWh: number }
export const NOMINAL_BATTERY: BatteryInput = { installed: true, soc: 55, mw: 0, hoursToLimit: 99, reserveNeededMWh: 0, energyMWh: 220 };
const bess = mk<BatteryInput>('battery');
export const BATTERY_RULES: readonly Rule<BatteryInput>[] = Object.freeze([
  bess({ id: 'BES-01', description: 'Battery reaches empty or full within the hour at the present rate.', inputs: ['soc', 'mw', 'hoursToLimit'], threshold: assumed('Energy horizon', 1, 'h'), condition: (i, th) => i.installed && Math.abs(i.mw) > 0.5 && i.hoursToLimit < th, action: 'publish', severity: 'advisory', examples: { fires: [{ mw: 100, hoursToLimit: 0.6 }], quiet: [{ mw: 100, hoursToLimit: 2 }, { mw: 0, hoursToLimit: 0.5 }] } }),
  bess({ id: 'BES-02', description: 'Stored energy below what an active recommendation needs.', inputs: ['energyMWh', 'reserveNeededMWh'], threshold: typical('Reserve shortfall', 0, 'MWh'), condition: (i, th) => i.installed && i.reserveNeededMWh > 0 && i.energyMWh - i.reserveNeededMWh < th, action: 'alarm', severity: 'warning', examples: { fires: [{ energyMWh: 50, reserveNeededMWh: 100 }], quiet: [{ energyMWh: 200, reserveNeededMWh: 100 }] } }),
]);

// --- gas -----------------------------------------------------------------------------------------------------
export interface GasInput { installed: boolean; starting: boolean; minutesToFull: number; available: boolean }
export const NOMINAL_GAS: GasInput = { installed: true, starting: false, minutesToFull: 0, available: true };
const gas = mk<GasInput>('gas');
export const GAS_RULES: readonly Rule<GasInput>[] = Object.freeze([
  gas({ id: 'GAS-01', description: 'Start in progress.', inputs: ['starting', 'minutesToFull'], threshold: PLANT.gasSyncMin, condition: (i) => i.installed && i.starting, action: 'publish', severity: 'info', examples: { fires: [{ starting: true, minutesToFull: 12 }], quiet: [{ starting: false }] } }),
  gas({ id: 'GAS-02', description: 'Unit unavailable.', inputs: ['available'], threshold: typical('Available', 1, 'flag'), condition: (i) => i.installed && !i.available, action: 'publish', severity: 'advisory', examples: { fires: [{ available: false }], quiet: [{ available: true }, { installed: false, available: false }] } }),
]);

// --- demand --------------------------------------------------------------------------------------------------
export interface DemandInput { offSupplyMW: number; shedMW: number; households: number; rampingMW: number }
export const NOMINAL_DEMAND: DemandInput = { offSupplyMW: 0, shedMW: 0, households: 0, rampingMW: 0 };
const dem = mk<DemandInput>('demand');
export const DEMAND_RULES: readonly Rule<DemandInput>[] = Object.freeze([
  dem({ id: 'DEM-01', description: 'Customers off supply.', inputs: ['offSupplyMW', 'households'], threshold: typical('Off supply', 0.5, 'MW'), condition: (i, th) => i.offSupplyMW > th, action: 'alarm', severity: 'critical', examples: { fires: [{ offSupplyMW: 240, households: 160000 }], quiet: [{ offSupplyMW: 0 }] } }),
  dem({ id: 'DEM-02', description: 'Demand shedding in progress.', inputs: ['shedMW', 'households'], threshold: typical('Shed', 0.5, 'MW'), condition: (i, th) => i.shedMW > th, action: 'alarm', severity: 'warning', examples: { fires: [{ shedMW: 60, households: 40000 }], quiet: [{ shedMW: 0 }] } }),
  dem({ id: 'DEM-03', description: 'Demand ramping towards a new level.', inputs: ['rampingMW'], threshold: assumed('Ramp reported above', 10, 'MW'), condition: (i, th) => Math.abs(i.rampingMW) > th, action: 'publish', severity: 'info', examples: { fires: [{ rampingMW: 120 }], quiet: [{ rampingMW: 3 }] } }),
]);

// --- ties --------------------------------------------------------------------------------------------------------
export interface TieInput { border: boolean; coupled: boolean; transferMW: number; limitMW: number; requestedMW: number }
export const NOMINAL_TIE: TieInput = { border: false, coupled: true, transferMW: 0, limitMW: 200, requestedMW: 0 };
const tie = mk<TieInput>('tie');
export const TIE_RULES: readonly Rule<TieInput>[] = Object.freeze([
  tie({ id: 'TIE-01', description: 'Loss of coupling: Ireland and Northern Ireland are running as separate systems.', inputs: ['coupled'], threshold: typical('Coupled', 1, 'flag'), condition: (i) => i.border && !i.coupled, action: 'recommend', severity: 'critical', examples: { fires: [{ border: true, coupled: false }], quiet: [{ border: true, coupled: true }, { border: false, coupled: false }] } }),
  tie({ id: 'TIE-02', description: 'Transfer near its limit.', inputs: ['transferMW', 'limitMW'], threshold: assumed('Transfer advisory', 0.9, 'per unit of limit'), condition: (i, th) => Math.abs(i.transferMW) > th * i.limitMW, action: 'publish', severity: 'advisory', examples: { fires: [{ transferMW: 190, limitMW: 200 }], quiet: [{ transferMW: 150, limitMW: 200 }] } }),
  tie({ id: 'TIE-03', description: 'Transfer request pending: ramping to the requested value.', inputs: ['transferMW', 'requestedMW'], threshold: assumed('Pending request reported above', 5, 'MW'), condition: (i, th) => Math.abs(i.requestedMW - i.transferMW) > th, action: 'publish', severity: 'info', examples: { fires: [{ transferMW: 40, requestedMW: 150 }], quiet: [{ transferMW: 150, requestedMW: 150 }] } }),
]);

// --- 400 kV infeed ---------------------------------------------------------------------------------------------
export interface InfeedInput { gridMW: number; importLimit: number; exportLimit: number; n1HeadroomMW: number }
export const NOMINAL_INFEED: InfeedInput = { gridMW: 400, importLimit: RATINGS.gridImport.value, exportLimit: RATINGS.gridExport.value, n1HeadroomMW: 100 };
const grd = mk<InfeedInput>('infeed');
export const INFEED_RULES: readonly Rule<InfeedInput>[] = Object.freeze([
  grd({ id: 'GRD-01', description: 'Import near the 400 kV limit.', inputs: ['gridMW', 'importLimit'], threshold: assumed('Import advisory', 0.9, 'per unit of limit'), condition: (i, th) => i.gridMW > th * i.importLimit, action: 'alarm', severity: 'warning', examples: { fires: [{ gridMW: 850 }], quiet: [{ gridMW: 700 }] } }),
  grd({ id: 'GRD-02', description: 'Export near the 400 kV limit.', inputs: ['gridMW', 'exportLimit'], threshold: assumed('Export advisory', 0.9, 'per unit of limit'), condition: (i, th) => -i.gridMW > th * i.exportLimit, action: 'alarm', severity: 'warning', examples: { fires: [{ gridMW: -660 }], quiet: [{ gridMW: -400 }] } }),
  grd({ id: 'GRD-03', description: 'N-1 headroom below zero: the loss of one 400/220 kV unit would overload the other.', inputs: ['n1HeadroomMW'], threshold: typical('Headroom', 0, 'MW'), condition: (i, th) => i.n1HeadroomMW < th, action: 'recommend', severity: 'warning', examples: { fires: [{ n1HeadroomMW: -50 }], quiet: [{ n1HeadroomMW: 20 }] } }),
]);
