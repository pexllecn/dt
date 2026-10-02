import { sourced, type Sourced } from '@/lib/sourced';

/**
 * Electrical parameters by voltage class. Typical values for the conductor and cable classes
 * used on 400, 275, 220 and 110 kV systems; not EirGrid or SONI data. Every branch in the
 * simulation takes its reactance and thermal rating from here.
 */
export interface CircuitClass {
  xOhmPerKm: Sourced;
  winterMVA: Sourced;
  summerMVA: Sourced;
}

const typical = 'Typical value for this voltage and construction';

export const overhead: Record<number, CircuitClass> = {
  400: {
    xOhmPerKm: sourced(0.32, 'Ω/km', 'Assumption', `${typical} (twin or triple conductor bundle)`),
    winterMVA: sourced(1600, 'MVA', 'Assumption', typical),
    summerMVA: sourced(1370, 'MVA', 'Assumption', typical),
  },
  275: {
    xOhmPerKm: sourced(0.38, 'Ω/km', 'Assumption', typical),
    winterMVA: sourced(880, 'MVA', 'Assumption', typical),
    summerMVA: sourced(760, 'MVA', 'Assumption', typical),
  },
  220: {
    xOhmPerKm: sourced(0.4, 'Ω/km', 'Assumption', typical),
    winterMVA: sourced(510, 'MVA', 'Assumption', `${typical} (single conductor, 600 mm² class)`),
    summerMVA: sourced(430, 'MVA', 'Assumption', typical),
  },
  110: {
    xOhmPerKm: sourced(0.4, 'Ω/km', 'Assumption', typical),
    winterMVA: sourced(140, 'MVA', 'Assumption', `${typical} (300 mm² class, older design temperature)`),
    summerMVA: sourced(120, 'MVA', 'Assumption', typical),
  },
};

export const underground: Record<number, CircuitClass> = {
  400: {
    xOhmPerKm: sourced(0.16, 'Ω/km', 'Assumption', typical),
    winterMVA: sourced(1200, 'MVA', 'Assumption', typical),
    summerMVA: sourced(1100, 'MVA', 'Assumption', typical),
  },
  275: {
    xOhmPerKm: sourced(0.15, 'Ω/km', 'Assumption', typical),
    winterMVA: sourced(700, 'MVA', 'Assumption', typical),
    summerMVA: sourced(640, 'MVA', 'Assumption', typical),
  },
  220: {
    xOhmPerKm: sourced(0.14, 'Ω/km', 'Assumption', `${typical} (XLPE)`),
    winterMVA: sourced(550, 'MVA', 'Assumption', typical),
    summerMVA: sourced(500, 'MVA', 'Assumption', typical),
  },
  110: {
    xOhmPerKm: sourced(0.13, 'Ω/km', 'Assumption', `${typical} (XLPE)`),
    winterMVA: sourced(190, 'MVA', 'Assumption', typical),
    summerMVA: sourced(170, 'MVA', 'Assumption', typical),
  },
};

export interface TransformerClass {
  ratingMVA: Sourced;
  /** Leakage reactance in per unit on the transformer's own rating. */
  xPuOwn: Sourced;
  /** Units per station where the data does not say. */
  units: Sourced;
}

export const transformers: Record<string, TransformerClass> = {
  '400/220': {
    ratingMVA: sourced(500, 'MVA', 'Assumption', typical),
    xPuOwn: sourced(0.14, 'pu', 'Assumption', typical),
    units: sourced(2, 'units', 'Assumption', 'Two units per station where not known'),
  },
  '275/110': {
    ratingMVA: sourced(240, 'MVA', 'Assumption', typical),
    xPuOwn: sourced(0.13, 'pu', 'Assumption', typical),
    units: sourced(2, 'units', 'Assumption', 'Two units per station where not known'),
  },
  '220/110': {
    ratingMVA: sourced(250, 'MVA', 'Assumption', typical),
    xPuOwn: sourced(0.13, 'pu', 'Assumption', typical),
    units: sourced(2, 'units', 'Assumption', 'Two units per station where not known'),
  },
  '400/110': {
    ratingMVA: sourced(250, 'MVA', 'Assumption', typical),
    xPuOwn: sourced(0.14, 'pu', 'Assumption', typical),
    units: sourced(2, 'units', 'Assumption', 'Two units per station where not known'),
  },
  '275/220': {
    ratingMVA: sourced(500, 'MVA', 'Assumption', typical),
    xPuOwn: sourced(0.12, 'pu', 'Assumption', typical),
    units: sourced(2, 'units', 'Assumption', 'Two units per station where not known'),
  },
};

export const baseMVA = sourced(100, 'MVA', 'Assumption', 'Per-unit system base');

/** Conductor data for the thermal and sag model (simplified IEEE 738 heat balance). */
export interface ConductorClass {
  diameterMm: Sourced;
  resistanceOhmPerKmAt20: Sourced;
  maxDesignTempC: Sourced;
  rulingSpanM: Sourced;
  sagAtDesignM: Sourced;
}

export const conductors: Record<number, ConductorClass> = {
  400: {
    diameterMm: sourced(31.5, 'mm', 'Assumption', 'Typical ACSR sub-conductor'),
    resistanceOhmPerKmAt20: sourced(0.034, 'Ω/km', 'Assumption', 'Per phase, bundle'),
    maxDesignTempC: sourced(75, '°C', 'Assumption', typical),
    rulingSpanM: sourced(380, 'm', 'Assumption', typical),
    sagAtDesignM: sourced(13, 'm', 'Assumption', typical),
  },
  275: {
    diameterMm: sourced(28.6, 'mm', 'Assumption', typical),
    resistanceOhmPerKmAt20: sourced(0.05, 'Ω/km', 'Assumption', typical),
    maxDesignTempC: sourced(75, '°C', 'Assumption', typical),
    rulingSpanM: sourced(350, 'm', 'Assumption', typical),
    sagAtDesignM: sourced(11.5, 'm', 'Assumption', typical),
  },
  220: {
    diameterMm: sourced(31.5, 'mm', 'Assumption', typical),
    resistanceOhmPerKmAt20: sourced(0.068, 'Ω/km', 'Assumption', typical),
    maxDesignTempC: sourced(80, '°C', 'Assumption', 'Uprated design temperature'),
    rulingSpanM: sourced(330, 'm', 'Assumption', typical),
    sagAtDesignM: sourced(10.5, 'm', 'Assumption', typical),
  },
  110: {
    diameterMm: sourced(21.0, 'mm', 'Assumption', typical),
    resistanceOhmPerKmAt20: sourced(0.13, 'Ω/km', 'Assumption', typical),
    maxDesignTempC: sourced(50, '°C', 'Assumption', 'Older lines were designed for 50 °C'),
    rulingSpanM: sourced(240, 'm', 'Assumption', 'Wood poleset spans'),
    sagAtDesignM: sourced(6.5, 'm', 'Assumption', typical),
  },
};

export function circuitClass(kv: number, cable: boolean): CircuitClass {
  const table = cable ? underground : overhead;
  const keys = Object.keys(table).map(Number);
  const k = keys.reduce((best, v) => (Math.abs(v - kv) < Math.abs(best - kv) ? v : best), keys[0]!);
  return table[k]!;
}

export function transformerClass(hi: number, lo: number): TransformerClass {
  return transformers[`${hi}/${lo}`] ?? transformers['220/110']!;
}

/**
 * Documented corrections where the map data is known to be incomplete. Each entry names the
 * branch by its label and says why. Kept short and visible on purpose.
 */
export interface BranchOverride {
  match: string;
  circuits?: number;
  note: string;
}

export const branchOverrides: BranchOverride[] = [
  {
    match: 'Huntstown TEG to Finglas 220 kV',
    circuits: 2,
    note: 'Assumption: generating station export modelled as two circuits; map data tags one',
  },
  {
    match: 'Huntstown to Huntstown TEG 220 kV',
    circuits: 2,
    note: 'Assumption: as above',
  },
];
