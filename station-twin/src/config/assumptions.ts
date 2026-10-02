/**
 * Single source of truth for every rating, constant and assumption in the simulation.
 * Each leaf is a Sourced value; the Method and assumptions panel is generated from this file.
 * Values marked "to confirm" are recalled typical values awaiting a check against the standard.
 */
import { assumed, sourced, typical, type Sourced } from '../lib/sourced.ts';

const IEC = 'IEC 60076-7 (loading guide for oil-immersed power transformers), to confirm';
const PROTO = 'Prototype value';

export const SITE = {
  latitude: assumed('Station latitude', 54.05, '° N', undefined, 'Fictional location in the border region'),
  longitude: assumed('Station longitude', -6.85, '° E', undefined, 'Fictional location in the border region'),
  epochUtcMs: assumed('Simulation date', Date.UTC(2026, 2, 10), 'ms', undefined, 'Tuesday 10 March 2026. Ireland observes GMT on this date'),
  baselineTime: assumed('Baseline time of day', 12 * 3600, 's', undefined, '12:00'),
} as const;

export const RATINGS = {
  T1: assumed('T1 rating (400/220 kV)', 450, 'MVA', PROTO),
  T2: assumed('T2 rating (400/220 kV)', 450, 'MVA', PROTO),
  T3: assumed('T3 rating (220/110 kV)', 250, 'MVA', PROTO),
  T4: assumed('T4 rating (275/220 kV, border tie)', 300, 'MVA', 'New in the rebuild'),
  gridImport: assumed('400 kV import limit', 900, 'MW', PROTO, 'Equal to the two 400/220 kV units at nameplate'),
  gridExport: assumed('400 kV export limit', 700, 'MW', PROTO),
  wind: assumed('Ballyhill Wind Farm capacity', 200, 'MW', PROTO, '40 turbines of 5 MW'),
  solar: assumed('Clonmore Solar Farm capacity', 150, 'MW AC', PROTO),
  gas: assumed('Peaking gas unit (OCGT) capacity', 180, 'MW', PROTO),
  battery: assumed('Battery power', 100, 'MW', PROTO),
  batteryEnergy: assumed('Battery energy', 400, 'MWh', PROTO, 'Four hours at full power'),
  borderTie: assumed('Border transfer limit', 250, 'MW', PROTO),
  ardnagreany: assumed('Ardnagreany transfer limit (220 kV)', 200, 'MW', PROTO),
  ballyduff: assumed('Ballyduff transfer limit (110 kV)', 150, 'MW', PROTO),
} as const;

export const BASELINE = {
  regionalDemand: assumed('Regional demand at baseline', 480, 'MW', PROTO, 'Towns, villages and commercial load, aggregated'),
  industrialDemand: assumed('Industrial park demand at baseline', 140, 'MW', PROTO),
  borderTransfer: assumed('Northbound transfer at baseline', 60, 'MW', PROTO),
  windAvailable: assumed('Wind available at baseline', 160, 'MW', PROTO),
  windDispatched: assumed('Wind dispatched at baseline', 120, 'MW', PROTO, '40 MW dispatched down by the system operator'),
  batterySoc: assumed('Battery state of charge at baseline', 55, '%', PROTO),
  householdPeakKw: assumed('After-diversity peak demand per household', 1.5, 'kW', undefined, 'Used only for "household equivalents"'),
} as const;

/** Thermal parameter set for one cooling mode (IEC 60076-7 exponential model). */
export interface ThermalSet {
  readonly x: number; // oil exponent
  readonly y: number; // winding exponent
  readonly k11: number;
  readonly k21: number;
  readonly k22: number;
  readonly tauOilMin: number;
  readonly tauWindingMin: number;
  /** Top-oil rise over ambient at rated load for this mode (K). */
  readonly topOilRiseK: number;
  /** Hot-spot to top-oil gradient at rated load for this mode (K). */
  readonly hotSpotGradientK: number;
}

export const THERMAL = {
  ONAN: typical<ThermalSet>('Thermal constants, ONAN', { x: 0.8, y: 1.3, k11: 0.5, k21: 2.0, k22: 2.0, tauOilMin: 210, tauWindingMin: 10, topOilRiseK: 52, hotSpotGradientK: 26 }, '', IEC, 'Large power transformers'),
  ONAF: typical<ThermalSet>('Thermal constants, ONAF', { x: 0.8, y: 1.3, k11: 0.5, k21: 2.0, k22: 2.0, tauOilMin: 150, tauWindingMin: 7, topOilRiseK: 52, hotSpotGradientK: 26 }, '', IEC, 'Large power transformers'),
  OF: typical<ThermalSet>('Thermal constants, OFAF', { x: 1.0, y: 1.3, k11: 1.0, k21: 1.3, k22: 1.0, tauOilMin: 90, tauWindingMin: 7, topOilRiseK: 46, hotSpotGradientK: 32 }, '', IEC, 'Large power transformers with forced oil'),
  lossRatio: typical('Load loss to no-load loss ratio, R', 6, '', IEC),
  /** Fraction of nameplate available at fan stage 0, 1, 2 for OFAF units (pumps running). */
  ofStageCapacity: assumed('OFAF capability by fan stage', [0.7, 0.85, 1.0] as const, 'per unit', undefined, 'Oil pumps run whenever the unit is energised'),
  /** Fraction of nameplate available at stage 0 (ONAN), 1, 2 (ONAF) for ONAF units. */
  onafStageCapacity: assumed('ONAN/ONAF capability by fan stage', [0.6, 0.8, 1.0] as const, 'per unit'),
  pumpFailedCapacity: assumed('OFAF capability with oil pumps failed', 0.5, 'per unit', undefined, 'Unit coolers rely on forced oil flow'),
  fanStage1On: typical('Fan stage 1 starts (winding temperature)', 80, '°C', undefined, 'Fans are switched by the winding temperature indicator'),
  fanStage1Off: typical('Fan stage 1 stops (winding temperature)', 70, '°C'),
  fanStage2On: typical('Fan stage 2 starts (winding temperature)', 90, '°C'),
  fanStage2Off: typical('Fan stage 2 stops (winding temperature)', 80, '°C'),
  ageingReferenceC: typical('Hot-spot for normal ageing', 98, '°C', IEC, 'Non-thermally upgraded paper'),
  ageingDoublingK: typical('Hot-spot rise that doubles ageing', 6, 'K', IEC),
  ambientMeanC: assumed('Mean ambient temperature (March)', 7.5, '°C'),
  ambientSwingC: assumed('Daily ambient swing (half amplitude)', 3.5, 'K', undefined, 'Warmest at 15:00'),
} as const;

export const LIMITS = {
  hotSpotNormalCyclic: typical('Hot-spot limit, normal cyclic loading', 120, '°C', IEC),
  hotSpotLongEmergency: typical('Hot-spot limit, long-time emergency', 140, '°C', IEC),
  topOilLimit: typical('Top-oil limit, normal cyclic loading', 105, '°C', IEC),
  currentNormalCyclic: typical('Current limit, normal cyclic loading', 1.3, 'per unit', IEC),
  currentShortEmergency: typical('Current limit, short-time emergency', 1.5, 'per unit', IEC),
  n1SecureLoading: assumed('N-1 secure if the remaining unit stays within', 1.3, 'per unit', undefined, 'The normal cyclic current limit'),
} as const;

export const PROTECTION = {
  wtiAlarm: typical('Winding temperature alarm', 110, '°C'),
  wtiTrip: typical('Winding temperature trip', 140, '°C'),
  otiAlarm: typical('Oil temperature alarm', 95, '°C'),
  otiTrip: typical('Oil temperature trip', 110, '°C'),
  overcurrentPickup: assumed('Backup overcurrent pickup', 2.0, 'per unit', undefined, 'Set above maximum overload so it acts only on faults'),
  overcurrentDelayS: assumed('Backup overcurrent delay', 2, 's'),
  differentialTripMs: typical('Differential protection operating time', 80, 'ms'),
} as const;

export const PLANT = {
  windCutIn: typical('Wind turbine cut-in speed', 3, 'm/s'),
  windRated: typical('Wind turbine rated speed', 12.5, 'm/s'),
  windStormStart: typical('High-wind ramp-down starts', 22, 'm/s', undefined, 'Soft cut-out (storm control)'),
  windCutOut: typical('High-wind cut-out', 28, 'm/s'),
  windRestart: typical('Restart after high-wind cut-out', 20, 'm/s'),
  gasSyncMin: assumed('Gas unit start to synchronisation', 5, 'min'),
  gasRampMwPerMin: assumed('Gas unit ramp rate', 18, 'MW/min', undefined, 'Full output 15 minutes after a start command'),
  gasMinStable: typical('Gas unit minimum stable generation', 0.4, 'per unit'),
  batteryRoundTrip: assumed('Battery round-trip efficiency', 0.88, '', undefined, 'Split equally between charge and discharge'),
  batterySocMin: assumed('Battery minimum state of charge', 5, '%'),
  batterySocMax: assumed('Battery maximum state of charge', 95, '%'),
  transferRampMwPerMin: assumed('Transfer request ramp', 15, 'MW/min', undefined, 'National Control Centre redispatch takes about 10 minutes'),
  solarGain: assumed('Solar clear-sky gain', 1.25, '', undefined, 'Output = capacity × gain × sin(elevation)^1.1, capped at 1'),
  solarExponent: assumed('Solar elevation exponent', 1.1, ''),
  cloudAttenuation: assumed('Solar attenuation at full cloud cover', 0.75, ''),
  baselineCloud: assumed('Baseline cloud cover', 0.3, '', undefined, 'Bright, broken cloud'),
  eveningPeakRampMin: assumed('Evening peak ramp duration', 30, 'min'),
} as const;

export const FREQUENCY = {
  nominal: typical('Nominal frequency', 50, 'Hz'),
  operatingBandLow: typical('Normal operating band, low', 49.8, 'Hz'),
  operatingBandHigh: typical('Normal operating band, high', 50.2, 'Hz'),
  rocofLimit: typical('Rate of change of frequency limit', 1.0, 'Hz/s', undefined, 'Measured over 500 ms'),
  kineticEnergyIreland: assumed('Kinetic energy, Ireland', 17000, 'MWs'),
  kineticEnergyNI: assumed('Kinetic energy, Northern Ireland', 6000, 'MWs'),
  responseIreland: assumed('Primary response, Ireland', 1400, 'MW/Hz'),
  responseNI: assumed('Primary response, Northern Ireland', 400, 'MW/Hz'),
  dampingIreland: assumed('Load damping, Ireland', 100, 'MW/Hz'),
  dampingNI: assumed('Load damping, Northern Ireland', 50, 'MW/Hz'),
  reserveLagS: assumed('Primary reserve response time constant', 3, 's'),
  restorationTauS: assumed('Secondary and tertiary restoration time constant', 180, 's', undefined, 'Rest of the system follows the station with this lag'),
  eventThresholdMw: assumed('Smallest step reported as a frequency event', 10, 'MW'),
} as const;

export const CLOCK = {
  stepS: assumed('Simulation step', 5, 's'),
  defaultCompression: assumed('Default time compression', 120, '×', undefined, '1 s = 2 min'),
  compressions: assumed('Available compressions', [10, 30, 60, 120, 300, 600] as const, '×'),
  timeLapse: assumed('Time-lapse compression', 1800, '×', undefined, '1 s = 30 min, always labelled'),
} as const;

/** Statements of what the model does not do. Shown in the Method panel. */
export const SIMPLIFICATIONS: readonly Sourced<string>[] = [
  sourced('Reactive power and voltage', 'Not modelled. Loading is MW against MVA rating, which understates loading by about 5% at a power factor of 0.95.', '', 'Simplification'),
  sourced('Losses', 'The station balance is lossless.', '', 'Simplification'),
  sourced('Parallel transformers', 'T1 and T2 share load by impedance. They are identical, so they share equally.', '', 'Simplification'),
  sourced('Neighbour transfers', 'Modelled as requests to the National Control Centre that take effect over about 10 minutes. In a meshed network these flows result from dispatch elsewhere.', '', 'Simplification'),
  sourced('Border tie', 'A scheduled interchange through T4 at 275 kV, not a load.', '', 'Simplification'),
  sourced('Loss of mains', 'Local generation cannot run islanded. It stops when its busbar is de-energised.', '', 'Simplification'),
  sourced('System response', 'The rest of the island follows any change in the station\'s net draw with a lag. Frequency is a two-area aggregate model, not a dynamic study.', '', 'Simplification'),
  sourced('Geography', 'Distances are compressed for composition. The electrical model has no line impedances, so no number changes.', '', 'Simplification'),
];

type Leaf = Sourced<unknown>;
const GROUPS: Record<string, Record<string, Leaf>> = {
  Site: SITE,
  Ratings: RATINGS,
  Baseline: BASELINE,
  'Transformer thermal model': THERMAL,
  Limits: LIMITS,
  Protection: PROTECTION,
  Plant: PLANT,
  Frequency: FREQUENCY,
  Clock: CLOCK,
};

export interface AssumptionRow {
  id: string;
  group: string;
  label: string;
  value: string;
  unit: string;
  source: string;
  ref: string;
  note: string;
}

function show(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (v && typeof v === 'object') return Object.entries(v as Record<string, number>).map(([k, n]) => `${k} ${n}`).join(', ');
  return String(v);
}

/** Flat table for the Method and assumptions panel and for the copy and provenance tests. */
export function assumptionTable(): AssumptionRow[] {
  const rows: AssumptionRow[] = [];
  for (const [group, items] of Object.entries(GROUPS)) {
    for (const [key, leaf] of Object.entries(items)) {
      rows.push({
        id: `${group}.${key}`,
        group,
        label: leaf.label,
        value: key === 'epochUtcMs' ? '10 March 2026' : show(leaf.value),
        unit: key === 'epochUtcMs' ? '' : leaf.unit,
        source: leaf.source,
        ref: leaf.ref ?? '',
        note: leaf.note ?? '',
      });
    }
  }
  for (const s of SIMPLIFICATIONS) {
    rows.push({ id: `Simplification.${s.label}`, group: 'Simplifications', label: s.label, value: s.value, unit: '', source: s.source, ref: '', note: '' });
  }
  return rows;
}
