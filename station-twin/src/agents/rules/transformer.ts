/**
 * Transformer rule sets. Base: the five alarms a conventional scheme raises. Extended: thirty
 * rules over loading, hot-spot, rate of rise and the agent's own thermal model, cooling state,
 * ambient, and N-1 headroom. Every input is simulated; none is synthetic.
 */
import { LIMITS, PROTECTION, THERMAL } from '../../config/assumptions.ts';
import { assumed, typical } from '../../lib/sourced.ts';
import type { Rule } from '../types.ts';

const IEC = 'IEC 60076-7, to confirm';

export interface TxInput {
  energised: boolean;
  tripped: boolean;
  loadPU: number;
  /** Loading 10 minutes ago (per unit). */
  loadPU10Ago: number;
  minutesAbove100: number;
  /** Highest loading in the next 30 minutes from the coordinator's forecast. */
  projectedLoad30: number;
  hotSpot: number;
  topOil: number;
  ambient: number;
  ageingRate: number;
  /** Equivalent hours of ageing beyond normal accumulated in this event. */
  excessAgeingHours: number;
  /** Hot-spot rate of rise over the last 5 minutes (K per minute). */
  hotSpotRateKMin: number;
  /** Top-oil rise over the last 10 minutes (K). */
  topOilRise10K: number;
  /** Loading changed by under 3% over the last 10 minutes. */
  loadSteady: boolean;
  /** Top-oil from the agent's own thermal model of a healthy unit. */
  expectedTopOil: number;
  /** Measured top-oil minus the agent's expectation (K). */
  residualK: number;
  /** Residual has grown throughout the last 15 minutes. */
  residualGrowing15: boolean;
  hotSpotRisingLoadFalling: boolean;
  stage: number;
  /** Stage the winding temperature calls for. */
  stageCalled: number;
  /** Minutes the stage has been below what the winding temperature calls for. */
  stageShortfallMin: number;
  forced: boolean;
  forcedHours: number;
  /** From the coordinator's forecast. */
  projectedHotSpot60: number;
  minutesTo120: number;
  minutesTo140: number;
  /** Forecast rise in loading within 60 minutes (per unit). */
  forecastLoadRise60: number;
  /** Ambient-adjusted continuous rating (per unit). */
  ratingPU: number;
  /** Loading of this unit after loss of its partner, or 0 when not applicable. */
  n1LoadPU: number;
  /** Minutes to 120 °C after loss of the partner, or 999. */
  n1MinutesTo120: number;
}

/** A quiet, healthy unit at moderate load: the base every example overrides. */
export const NOMINAL_TX: TxInput = {
  energised: true, tripped: false, loadPU: 0.6, loadPU10Ago: 0.6, minutesAbove100: 0, projectedLoad30: 0.6,
  hotSpot: 72, topOil: 46, ambient: 8, ageingRate: 0.05, excessAgeingHours: 0, hotSpotRateKMin: 0, topOilRise10K: 0,
  loadSteady: true, expectedTopOil: 46, residualK: 0, residualGrowing15: false, hotSpotRisingLoadFalling: false,
  stage: 0, stageCalled: 0, stageShortfallMin: 0, forced: false, forcedHours: 0, projectedHotSpot60: 72, minutesTo120: 999, minutesTo140: 999,
  forecastLoadRise60: 0, ratingPU: 1.1, n1LoadPU: 0.9, n1MinutesTo120: 999,
};

type R = Rule<TxInput>;
const base = (r: Omit<R, 'assetType' | 'maturity' | 'version'>): R => Object.freeze({ ...r, assetType: 'transformer', maturity: 'base', version: '1.0' });
const ext = (r: Omit<R, 'assetType' | 'maturity' | 'version'>): R => Object.freeze({ ...r, assetType: 'transformer', maturity: 'extended', version: '1.0' });
const on = (i: TxInput) => i.energised && !i.tripped;

export const TX_BASE: readonly R[] = Object.freeze([
  base({ id: 'TX-B-01', description: 'Loading above nameplate.', inputs: ['loadPU'], threshold: typical('Nameplate loading', 1.0, 'per unit'), condition: (i, th) => on(i) && i.loadPU > th, action: 'alarm', severity: 'warning', examples: { fires: [{ loadPU: 1.05 }], quiet: [{ loadPU: 0.95 }] } }),
  base({ id: 'TX-B-02', description: 'Winding hot-spot above the temperature alarm.', reference: 'WTI alarm', inputs: ['hotSpot'], threshold: PROTECTION.wtiAlarm, condition: (i, th) => on(i) && i.hotSpot > th, action: 'alarm', severity: 'warning', examples: { fires: [{ hotSpot: 112 }], quiet: [{ hotSpot: 108 }] } }),
  base({ id: 'TX-B-03', description: 'Top-oil above the oil temperature alarm.', reference: 'OTI alarm', inputs: ['topOil'], threshold: PROTECTION.otiAlarm, condition: (i, th) => on(i) && i.topOil > th, action: 'alarm', severity: 'warning', examples: { fires: [{ topOil: 97 }], quiet: [{ topOil: 93 }] } }),
  base({ id: 'TX-B-04', description: 'Winding hot-spot approaching the trip.', inputs: ['hotSpot'], threshold: typical('Approaching the winding temperature trip', 130, '°C'), condition: (i, th) => on(i) && i.hotSpot > th, action: 'alarm', severity: 'critical', examples: { fires: [{ hotSpot: 132 }], quiet: [{ hotSpot: 125 }] } }),
  base({ id: 'TX-B-05', description: 'Protection has operated and the unit is locked out.', inputs: ['tripped'], threshold: typical('Protection operated', 1, 'flag'), condition: (i) => i.tripped, action: 'alarm', severity: 'critical', examples: { fires: [{ tripped: true }], quiet: [{ tripped: false }] } }),
]);

export const TX_EXTENDED: readonly R[] = Object.freeze([
  // Loading (6)
  ext({ id: 'TX-E-01', description: 'Loading above 90% of nameplate.', inputs: ['loadPU'], threshold: assumed('Early loading advisory', 0.9, 'per unit'), condition: (i, th) => on(i) && i.loadPU > th, action: 'publish', severity: 'advisory', examples: { fires: [{ loadPU: 0.92 }], quiet: [{ loadPU: 0.88 }] } }),
  ext({ id: 'TX-E-02', description: 'Loading above nameplate for over 30 minutes.', inputs: ['loadPU', 'minutesAbove100'], threshold: assumed('Sustained overload duration', 30, 'min'), condition: (i, th) => on(i) && i.loadPU > 1 && i.minutesAbove100 > th, action: 'alarm', severity: 'warning', examples: { fires: [{ loadPU: 1.05, minutesAbove100: 35 }], quiet: [{ loadPU: 1.05, minutesAbove100: 20 }] } }),
  ext({ id: 'TX-E-03', description: 'Loading above the normal cyclic current limit.', reference: IEC, inputs: ['loadPU'], threshold: LIMITS.currentNormalCyclic, condition: (i, th) => on(i) && i.loadPU > th, action: 'recommend', severity: 'critical', examples: { fires: [{ loadPU: 1.35 }], quiet: [{ loadPU: 1.25 }] } }),
  ext({ id: 'TX-E-04', description: 'Loading above the short-time emergency limit.', reference: IEC, inputs: ['loadPU'], threshold: LIMITS.currentShortEmergency, condition: (i, th) => on(i) && i.loadPU > th, action: 'recommend', severity: 'critical', examples: { fires: [{ loadPU: 1.55 }], quiet: [{ loadPU: 1.45 }] } }),
  ext({ id: 'TX-E-05', description: 'Loading forecast to exceed nameplate within 30 minutes.', inputs: ['loadPU', 'projectedLoad30'], threshold: typical('Nameplate loading', 1.0, 'per unit'), condition: (i, th) => on(i) && i.loadPU <= th && i.projectedLoad30 > th, action: 'recommend', severity: 'advisory', examples: { fires: [{ loadPU: 0.95, projectedLoad30: 1.08 }], quiet: [{ loadPU: 0.95, projectedLoad30: 0.97 }] } }),
  ext({ id: 'TX-E-06', description: 'Loading rising faster than 10% of nameplate in 10 minutes.', inputs: ['loadPU', 'loadPU10Ago'], threshold: assumed('Fast loading rise', 0.1, 'per unit per 10 min'), condition: (i, th) => on(i) && i.loadPU - i.loadPU10Ago > th, action: 'publish', severity: 'advisory', examples: { fires: [{ loadPU: 0.8, loadPU10Ago: 0.65 }], quiet: [{ loadPU: 0.7, loadPU10Ago: 0.65 }] } }),
  // Hot-spot (6)
  ext({ id: 'TX-E-07', description: 'Hot-spot above 98 °C: insulation ageing faster than normal.', reference: IEC, inputs: ['hotSpot'], threshold: THERMAL.ageingReferenceC, condition: (i, th) => on(i) && i.hotSpot > th, action: 'publish', severity: 'advisory', examples: { fires: [{ hotSpot: 100 }], quiet: [{ hotSpot: 95 }] } }),
  ext({ id: 'TX-E-08', description: 'Ageing rate above four times normal.', reference: IEC, inputs: ['ageingRate'], threshold: assumed('High ageing rate', 4, '× normal'), condition: (i, th) => on(i) && i.ageingRate > th, action: 'alarm', severity: 'warning', examples: { fires: [{ ageingRate: 5 }], quiet: [{ ageingRate: 3 }] } }),
  ext({ id: 'TX-E-09', description: 'Hot-spot above the normal cyclic limit.', reference: IEC, inputs: ['hotSpot'], threshold: LIMITS.hotSpotNormalCyclic, condition: (i, th) => on(i) && i.hotSpot > th, action: 'recommend', severity: 'critical', examples: { fires: [{ hotSpot: 122 }], quiet: [{ hotSpot: 118 }] } }),
  ext({ id: 'TX-E-10', description: 'Hot-spot forecast to reach 120 °C within 60 minutes.', inputs: ['hotSpot', 'minutesTo120'], threshold: assumed('Look-ahead window, normal cyclic limit', 60, 'min'), condition: (i, th) => on(i) && i.hotSpot < 120 && i.minutesTo120 <= th, action: 'recommend', severity: 'warning', examples: { fires: [{ hotSpot: 105, minutesTo120: 40 }], quiet: [{ hotSpot: 105, minutesTo120: 90 }] } }),
  ext({ id: 'TX-E-11', description: 'Hot-spot forecast to reach the 140 °C trip within 60 minutes.', inputs: ['hotSpot', 'minutesTo140'], threshold: assumed('Look-ahead window, trip', 60, 'min'), condition: (i, th) => on(i) && i.minutesTo140 <= th, action: 'recommend', severity: 'critical', examples: { fires: [{ hotSpot: 125, minutesTo140: 30 }], quiet: [{ hotSpot: 125, minutesTo140: 120 }] } }),
  ext({ id: 'TX-E-12', description: "Loss of life in this event above one day's normal ageing.", reference: IEC, inputs: ['excessAgeingHours'], threshold: assumed('Event loss-of-life advisory', 24, 'h equivalent'), condition: (i, th) => i.excessAgeingHours > th, action: 'publish', severity: 'warning', examples: { fires: [{ excessAgeingHours: 30 }], quiet: [{ excessAgeingHours: 10 }] } }),
  // Rate of rise and model residual (6)
  ext({ id: 'TX-E-13', description: 'Hot-spot rising faster than 0.5 K per minute.', inputs: ['hotSpotRateKMin'], threshold: assumed('Fast hot-spot rise', 0.5, 'K/min'), condition: (i, th) => on(i) && i.hotSpotRateKMin > th, action: 'publish', severity: 'advisory', examples: { fires: [{ hotSpotRateKMin: 0.7 }], quiet: [{ hotSpotRateKMin: 0.3 }] } }),
  ext({ id: 'TX-E-14', description: 'Top-oil rising faster than 2 K in 10 minutes at steady load.', inputs: ['topOilRise10K', 'loadSteady'], threshold: assumed('Top-oil rise at steady load', 2, 'K per 10 min'), condition: (i, th) => on(i) && i.loadSteady && i.topOilRise10K > th, action: 'alarm', severity: 'warning', examples: { fires: [{ topOilRise10K: 2.5, loadSteady: true }], quiet: [{ topOilRise10K: 2.5, loadSteady: false }, { topOilRise10K: 1.5 }] } }),
  ext({ id: 'TX-E-15', description: "Top-oil more than 3 K above the agent's own thermal model.", inputs: ['topOil', 'expectedTopOil', 'residualK'], threshold: assumed('Model residual, advisory', 3, 'K'), condition: (i, th) => on(i) && i.residualK > th, action: 'alarm', severity: 'warning', examples: { fires: [{ topOil: 50, expectedTopOil: 46, residualK: 4 }], quiet: [{ residualK: 2 }] } }),
  ext({ id: 'TX-E-16', description: "Top-oil more than 6 K above the agent's own thermal model.", inputs: ['topOil', 'expectedTopOil', 'residualK'], threshold: assumed('Model residual, warning', 6, 'K'), condition: (i, th) => on(i) && i.residualK > th, action: 'recommend', severity: 'critical', examples: { fires: [{ residualK: 7 }], quiet: [{ residualK: 5 }] } }),
  ext({ id: 'TX-E-17', description: 'Model residual growing for 15 minutes.', inputs: ['residualK', 'residualGrowing15'], threshold: assumed('Residual growth before reporting', 1, 'K'), condition: (i, th) => on(i) && i.residualGrowing15 && i.residualK > th, action: 'alarm', severity: 'warning', examples: { fires: [{ residualGrowing15: true, residualK: 1.5 }], quiet: [{ residualGrowing15: false, residualK: 1.5 }, { residualGrowing15: true, residualK: 0.5 }] } }),
  ext({ id: 'TX-E-18', description: 'Hot-spot rising while load falls.', inputs: ['hotSpotRisingLoadFalling'], threshold: typical('Inconsistent trend', 1, 'flag'), condition: (i) => on(i) && i.hotSpotRisingLoadFalling, action: 'alarm', severity: 'warning', examples: { fires: [{ hotSpotRisingLoadFalling: true }], quiet: [{ hotSpotRisingLoadFalling: false }] } }),
  // Cooling state (5)
  ext({ id: 'TX-E-19', description: 'Cooling stage lower than the winding temperature calls for, for over 2 minutes.', inputs: ['stage', 'stageCalled', 'stageShortfallMin'], threshold: assumed('Stage shortfall duration', 2, 'min', undefined, 'Longer than the fan control takes to respond'), condition: (i, th) => on(i) && i.stageCalled > i.stage && i.stageShortfallMin > th, action: 'alarm', severity: 'warning', examples: { fires: [{ stage: 0, stageCalled: 1, stageShortfallMin: 5 }], quiet: [{ stage: 1, stageCalled: 1 }, { stage: 0, stageCalled: 1, stageShortfallMin: 1 }] } }),
  ext({ id: 'TX-E-20', description: 'All cooling running and temperature still rising.', inputs: ['stage', 'hotSpotRateKMin'], threshold: assumed('Still rising', 0.1, 'K/min'), condition: (i, th) => on(i) && i.stage === 2 && i.hotSpotRateKMin > th, action: 'publish', severity: 'advisory', examples: { fires: [{ stage: 2, hotSpotRateKMin: 0.2 }], quiet: [{ stage: 2, hotSpotRateKMin: 0.05 }, { stage: 1, hotSpotRateKMin: 0.2 }] } }),
  ext({ id: 'TX-E-21', description: 'Cooling less effective than expected: residual with cooling at maximum.', inputs: ['stage', 'residualK'], threshold: assumed('Residual at full cooling', 2, 'K'), condition: (i, th) => on(i) && i.stage === 2 && i.residualK > th, action: 'alarm', severity: 'warning', examples: { fires: [{ stage: 2, residualK: 3 }], quiet: [{ stage: 2, residualK: 1 }, { stage: 1, residualK: 3 }] } }),
  ext({ id: 'TX-E-22', description: 'Pre-cooling opportunity: loading forecast to rise by over 20% within 60 minutes and cooling not forced.', inputs: ['forecastLoadRise60', 'forced'], threshold: assumed('Forecast rise worth pre-cooling', 0.2, 'per unit'), condition: (i, th) => on(i) && !i.forced && i.forecastLoadRise60 > th, action: 'recommend', severity: 'advisory', examples: { fires: [{ forecastLoadRise60: 0.3 }], quiet: [{ forecastLoadRise60: 0.1 }, { forecastLoadRise60: 0.3, forced: true }] } }),
  ext({ id: 'TX-E-23', description: 'Forced cooling running for over 6 hours.', inputs: ['forced', 'forcedHours'], threshold: assumed('Long forced cooling', 6, 'h'), condition: (i, th) => i.forced && i.forcedHours > th, action: 'publish', severity: 'info', examples: { fires: [{ forced: true, forcedHours: 7 }], quiet: [{ forced: true, forcedHours: 2 }] } }),
  // Ambient (3)
  ext({ id: 'TX-E-24', description: 'Ambient above 25 °C: continuous rating reduced.', inputs: ['ambient'], threshold: assumed('Warm ambient', 25, '°C'), condition: (i, th) => i.ambient > th, action: 'publish', severity: 'info', examples: { fires: [{ ambient: 27 }], quiet: [{ ambient: 20 }] } }),
  ext({ id: 'TX-E-25', description: 'Ambient-adjusted rating below present loading.', inputs: ['ratingPU', 'loadPU'], threshold: typical('Rating margin', 0, 'per unit'), condition: (i, th) => on(i) && i.ratingPU - i.loadPU < th, action: 'alarm', severity: 'warning', examples: { fires: [{ ratingPU: 0.95, loadPU: 0.98 }], quiet: [{ ratingPU: 1.05, loadPU: 0.98 }] } }),
  ext({ id: 'TX-E-26', description: 'Ambient below 5 °C: cyclic overload capability available.', inputs: ['ambient'], threshold: assumed('Cold ambient', 5, '°C'), condition: (i, th) => on(i) && i.ambient < th, action: 'publish', severity: 'info', examples: { fires: [{ ambient: 3 }], quiet: [{ ambient: 8 }] } }),
  // N-1 headroom (4)
  ext({ id: 'TX-E-27', description: 'Loss of the partner unit would load this one above nameplate.', inputs: ['n1LoadPU'], threshold: typical('Nameplate loading', 1.0, 'per unit'), condition: (i, th) => on(i) && i.n1LoadPU > th, action: 'publish', severity: 'info', examples: { fires: [{ n1LoadPU: 1.1 }], quiet: [{ n1LoadPU: 0.9 }] } }),
  ext({ id: 'TX-E-28', description: 'Loss of the partner unit would load this one above the normal cyclic limit (N-1 insecure).', reference: IEC, inputs: ['n1LoadPU'], threshold: LIMITS.n1SecureLoading, condition: (i, th) => on(i) && i.n1LoadPU > th, action: 'recommend', severity: 'warning', examples: { fires: [{ n1LoadPU: 1.4 }], quiet: [{ n1LoadPU: 1.2 }] } }),
  ext({ id: 'TX-E-29', description: 'Loss of the partner unit would load this one above the short-time emergency limit.', reference: IEC, inputs: ['n1LoadPU'], threshold: LIMITS.currentShortEmergency, condition: (i, th) => on(i) && i.n1LoadPU > th, action: 'recommend', severity: 'critical', examples: { fires: [{ n1LoadPU: 1.6 }], quiet: [{ n1LoadPU: 1.4 }] } }),
  ext({ id: 'TX-E-30', description: 'After loss of the partner, the hot-spot would reach 120 °C in under 30 minutes.', inputs: ['n1MinutesTo120'], threshold: assumed('N-1 thermal time', 30, 'min'), condition: (i, th) => on(i) && i.n1MinutesTo120 < th, action: 'recommend', severity: 'warning', examples: { fires: [{ n1MinutesTo120: 20 }], quiet: [{ n1MinutesTo120: 45 }] } }),
]);
