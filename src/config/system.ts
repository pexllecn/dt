import { sourced, type Sourced } from '@/lib/sourced';

/**
 * System-level figures. Single source of truth for capacities and demand calibration.
 * Public figures are cited; everything else is an assumption or an approximation chosen to
 * match public orders of magnitude, and is labelled as such wherever it appears.
 */

// ---------------------------------------------------------------- demand
export const demand = {
  dcEnergy2025: sourced(7663, 'GWh', 'Public', 'Data centres, metered electricity consumption 2025 (CSO, July 2026)'),
  dcShare2025: sourced(0.23, 'share', 'Public', 'Data centres share of metered electricity 2025 (CSO, July 2026)'),
  dcShare2015: sourced(0.05, 'share', 'Public', 'Data centres share of metered electricity 2015 (CSO)'),
  dcShare2034: sourced(0.31, 'share', 'Public', 'EirGrid forecast cited by the CRU: data centres 31% of demand by 2034'),
  /** 2026 data centre load relative to the 2025 average. */
  dcGrowth2026: sourced(1.06, 'x 2025', 'Assumption', 'Growth from 2025 to the 2026 base year'),
  dcLoadFactor: sourced(0.92, 'ratio', 'Assumption', 'Data centre demand is near flat; small cooling-driven daily swing'),
  roiWinterPeak: sourced(6000, 'MW', 'Approximate', 'ROI winter peak, order of magnitude of recent winters'),
  niWinterPeak: sourced(1750, 'MW', 'Approximate', 'NI winter peak, order of magnitude'),
  niAnnualEnergy: sourced(8500, 'GWh', 'Approximate', 'NI annual demand, order of magnitude'),
  nonDcGrowthPerYear: sourced(0.025, 'per year', 'Assumption', 'Electrification of heat and transport, 2026 to 2034'),
  transmissionLosses: sourced(0.02, 'share', 'Assumption', 'Losses added to demand; DC power flow is lossless'),
};

export const dcAverageMW2025 = demand.dcEnergy2025.value / 8.76; // GWh -> average MW
export const roiAnnualEnergy2025 = demand.dcEnergy2025.value / demand.dcShare2025.value;

// ---------------------------------------------------------------- renewables
export const renewables = {
  windRoi2026: sourced(5000, 'MW', 'Approximate', 'Installed onshore wind, ROI, order of magnitude'),
  windNi2026: sourced(1400, 'MW', 'Approximate', 'Installed onshore wind, NI, order of magnitude'),
  windRoi2034: sourced(8000, 'MW', 'Assumption', 'Onshore wind 2034'),
  offshore2034: sourced(2500, 'MW', 'Assumption', 'Offshore wind on the east coast by 2034'),
  solarRoi2026: sourced(1500, 'MW', 'Approximate', 'Installed solar, ROI, order of magnitude'),
  solarRoi2034: sourced(5000, 'MW', 'Assumption', 'Installed solar 2034'),
  windAvailability: sourced(0.95, 'ratio', 'Assumption', 'Turbine availability and array losses'),
  cutIn: sourced(3, 'm/s', 'Assumption', 'Typical modern turbine'),
  rated: sourced(12.5, 'm/s', 'Assumption', 'Typical modern turbine'),
  cutOut: sourced(25, 'm/s', 'Assumption', 'High-wind shutdown'),
};

// ---------------------------------------------------------------- operational limits
export const operation = {
  snspCap: sourced(0.75, 'share', 'Assumption', 'System non-synchronous penetration limit (configurable)'),
  minUnits: sourced(5, 'units', 'Assumption', 'Minimum large synchronous units online, all-island (configurable)'),
};

// ---------------------------------------------------------------- dispatchable fleet
export type UnitKind = 'ccgt' | 'ocgt' | 'hydro' | 'pumped' | 'oil' | 'biomass';

export interface UnitSpec {
  id: string;
  name: string;
  station: string; // network station name
  kv: number;
  kind: UnitKind;
  capacity: Sourced;
  minStable: number; // share of capacity
  cost: number; // EUR/MWh, merit order only (Assumption)
  /** Counts towards the minimum-units constraint. */
  large: boolean;
}

const cap = (mw: number, note = 'Approximate capacity') => sourced(mw, 'MW', 'Approximate', note);

export const units: UnitSpec[] = [
  { id: 'aghada', name: 'Aghada', station: 'Aghada', kv: 220, kind: 'ccgt', capacity: cap(430), minStable: 0.45, cost: 92, large: true },
  { id: 'whitegate', name: 'Whitegate', station: 'Glanagow', kv: 220, kind: 'ccgt', capacity: cap(445), minStable: 0.45, cost: 90, large: true },
  { id: 'great-island', name: 'Great Island', station: 'Great Island', kv: 220, kind: 'ccgt', capacity: cap(460), minStable: 0.45, cost: 91, large: true },
  { id: 'tynagh', name: 'Tynagh', station: 'Tynagh', kv: 220, kind: 'ccgt', capacity: cap(400), minStable: 0.45, cost: 93, large: true },
  { id: 'huntstown', name: 'Huntstown', station: 'Huntstown', kv: 220, kind: 'ccgt', capacity: cap(750), minStable: 0.45, cost: 89, large: true },
  { id: 'dublin-bay', name: 'Dublin Bay', station: 'Irishtown', kv: 220, kind: 'ccgt', capacity: cap(415), minStable: 0.45, cost: 94, large: true },
  { id: 'ballylumford', name: 'Ballylumford', station: 'Ballycronan More', kv: 275, kind: 'ccgt', capacity: cap(600), minStable: 0.45, cost: 95, large: true },
  { id: 'coolkeeragh', name: 'Coolkeeragh', station: 'Coolkeeragh', kv: 275, kind: 'ccgt', capacity: cap(400), minStable: 0.45, cost: 96, large: true },
  { id: 'kilroot', name: 'Kilroot', station: 'Kilroot', kv: 275, kind: 'ocgt', capacity: cap(600), minStable: 0.2, cost: 160, large: false },
  { id: 'aghada-ocgt', name: 'Aghada peakers', station: 'Aghada', kv: 220, kind: 'ocgt', capacity: cap(270), minStable: 0.2, cost: 170, large: false },
  { id: 'turlough-hill', name: 'Turlough Hill', station: 'Turlough Hill', kv: 220, kind: 'pumped', capacity: cap(292), minStable: 0, cost: 120, large: false },
  { id: 'ardnacrusha', name: 'Ardnacrusha', station: 'Ardnacrusha', kv: 110, kind: 'hydro', capacity: cap(86), minStable: 0, cost: 30, large: false },
  { id: 'edenderry', name: 'Edenderry', station: 'Cushaling', kv: 110, kind: 'biomass', capacity: cap(118), minStable: 0.4, cost: 110, large: false },
  {
    id: 'moneypoint',
    name: 'Moneypoint (reserve)',
    station: 'Moneypoint',
    kv: 400,
    kind: 'oil',
    capacity: sourced(855, 'MW', 'Assumption', 'Modelled as oil-fired reserve after the end of coal firing; status to confirm'),
    minStable: 0.3,
    cost: 260,
    large: true,
  },
];

// ---------------------------------------------------------------- interconnectors
export interface InterconnectorSpec {
  id: string;
  name: string;
  station: string;
  kv: number;
  capacity: Sourced;
  status: 'operating' | 'planned';
  /** First year available in the growth slider. */
  from: number;
  /** Direction label for the far end. */
  farEnd: string;
}

export const interconnectors: InterconnectorSpec[] = [
  { id: 'ewic', name: 'East West', station: 'Woodland', kv: 400, capacity: cap(500, 'HVDC, approximate rating'), status: 'operating', from: 2012, farEnd: 'Wales' },
  { id: 'moyle', name: 'Moyle', station: 'Ballycronan More', kv: 275, capacity: cap(500, 'HVDC, approximate rating'), status: 'operating', from: 2002, farEnd: 'Scotland' },
  { id: 'greenlink', name: 'Greenlink', station: 'Great Island', kv: 220, capacity: cap(500, 'HVDC, approximate rating'), status: 'operating', from: 2025, farEnd: 'Wales' },
  { id: 'celtic', name: 'Celtic (planned)', station: 'Knockraha', kv: 220, capacity: cap(700, 'HVDC, planned'), status: 'planned', from: 2028, farEnd: 'France' },
];

// ---------------------------------------------------------------- storage
export const storage = {
  batteryRoi2026: sourced(900, 'MW', 'Approximate', 'Grid-scale batteries, ROI and NI, order of magnitude'),
  batteryHours: sourced(1, 'h', 'Assumption', 'Typical duration of current sites'),
};

// ---------------------------------------------------------------- large loads
export interface LargeLoadSpec {
  id: string;
  name: string;
  station: string;
  kv: number;
  /** Share of national data centre demand at this cluster (base year). */
  share: Sourced;
  hypothetical?: boolean;
}

export const dataCentreClusters: LargeLoadSpec[] = [
  { id: 'dc-clonee', name: 'West Dublin data centre cluster (Clonee)', station: 'Clonee', kv: 220, share: sourced(0.2, 'share', 'Assumption') },
  { id: 'dc-corduff', name: 'West Dublin data centre cluster (Corduff)', station: 'Corduff', kv: 110, share: sourced(0.14, 'share', 'Assumption') },
  { id: 'dc-grange', name: 'West Dublin data centre cluster (Grange Castle)', station: 'Grange Castle', kv: 110, share: sourced(0.16, 'share', 'Assumption') },
  { id: 'dc-kilmahud', name: 'West Dublin data centre cluster (Profile Park)', station: 'Kilmahud', kv: 110, share: sourced(0.12, 'share', 'Assumption') },
  { id: 'dc-finglas', name: 'North Dublin data centre cluster (Finglas)', station: 'Finglas', kv: 110, share: sourced(0.12, 'share', 'Assumption') },
  { id: 'dc-dardistown', name: 'North Dublin data centre cluster (Dardistown)', station: 'Dardistown', kv: 110, share: sourced(0.08, 'share', 'Assumption') },
  { id: 'dc-cork', name: 'Cork data centre sites', station: 'Knockraha', kv: 110, share: sourced(0.06, 'share', 'Assumption') },
  { id: 'dc-meath', name: 'Meath data centre sites', station: 'Woodland', kv: 220, share: sourced(0.06, 'share', 'Assumption') },
  { id: 'dc-other', name: 'Other data centre sites', station: 'Maynooth', kv: 110, share: sourced(0.06, 'share', 'Assumption') },
];

/** The hypothetical connection request at the heart of the hero scenario. */
export const northWestLargeUser = {
  id: 'nw-leu',
  name: 'North West Large Energy User',
  capacity: sourced(50, 'MW', 'Assumption', 'Hypothetical connection request'),
  station: 'Bellacorick',
  kv: 110,
  connectionNote: 'Connection point assumed: nearest existing 110 kV station in north Mayo',
};
