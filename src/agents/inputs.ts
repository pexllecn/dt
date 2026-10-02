/**
 * What each agent reads. Network quantities come from the simulation; condition-monitoring
 * quantities (gas analysis, surveys, counters) are synthetic, seeded per asset, and labelled
 * Synthetic wherever they are shown.
 */
export interface LineInput {
  kv: number;
  lengthKm: number;
  /** N loading: |flow| / seasonal rating. */
  loading: number;
  /** Worst loading after any single circuit outage. */
  n1Loading: number;
  n1Cause: string;
  mw: number;
  tripped: boolean;
  conductorTempC: number;
  designTempC: number;
  /** Design sag minus present sag (m): how much clearance is left before the design limit. */
  clearanceMarginM: number;
  windMs: number;
  ambientC: number;
  humidityPct: number;
  /** Hours above 90% loading so far today. */
  hoursAbove90: number;
  /** Hours with N-1 loading above 100% so far today. */
  hoursN1Above100: number;
  /** Mostly underground cable. */
  cable: boolean;
  /** Change in loading over the last hour (fraction per hour). */
  loadingRampPerHour: number;
  /** Extra rating available from the present weather (dynamic line rating), as a fraction. */
  dlrHeadroom: number;
  autoReclosesToday: number;
  faults12m: number;
  vegetationSurveyMonths: number;
  lightningKm: number;
  ageYears: number;
  insulatorDefects: number;
  towerCorrosionGrade: number;
  thermographyHotspotC: number;
  outageRequestsPending: number;
  stale: boolean;
}

export interface TransformerInput {
  loading: number;
  n1Loading: number;
  units: number;
  ambientC: number;
  topOilC: number;
  hotSpotC: number;
  /** Relative ageing rate (IEC 60076-7, non-thermally upgraded paper): 1 at 98 °C hot spot. */
  ageingRate: number;
  /** Equivalent ageing hours accumulated today. */
  ageingHoursToday: number;
  h2: number;
  ch4: number;
  c2h2: number;
  c2h4: number;
  c2h6: number;
  co: number;
  co2: number;
  /** ppm per month */
  c2h2Rate: number;
  h2Rate: number;
  moisturePpm: number;
  tapOps24h: number;
  tapOpsSinceService: number;
  bushingTanDeltaPct: number;
  bushingCapChangePct: number;
  coolingFault: boolean;
  oilLevelPct: number;
  buchholzAlarm: boolean;
  ageYears: number;
  stale: boolean;
}

export interface SubstationInput {
  kv: number;
  circuits: number;
  circuitsOut: number;
  maxBranchLoading: number;
  maxN1Loading: number;
  protectionHealthy: boolean;
  batteryChargerOk: boolean;
  commsOk: boolean;
  securityAlarm: boolean;
  stale: boolean;
}

export interface WindFarmInput {
  capacityMW: number;
  mw: number;
  availableMW: number;
  curtailedShare: number;
  windMs: number;
  cutOutMs: number;
  /** Max loading on the circuits leaving the cluster's station. */
  exportLoading: number;
  turbinesAvailable: number;
  stale: boolean;
}

export interface BatteryInput {
  capacityMW: number;
  energyMWh: number;
  soc: number;
  mw: number;
  cellTempC: number;
  cyclesToday: number;
  /** Max N-1 loading on the corridor the battery can relieve. */
  corridorN1: number;
  stale: boolean;
}

export interface LargeLoadInput {
  mw: number;
  contractedMW: number;
  firmMW: number;
  flexibleMW: number;
  /** Max N-1 loading on the circuits feeding the site. */
  feedN1: number;
  backupFuelHours: number;
  hypothetical: boolean;
  stale: boolean;
}

export interface InterconnectorInput {
  mw: number;
  capacityMW: number;
  scheduleMW: number;
  /** Max N-1 loading at the converter station. */
  stationN1: number;
  snsp: number;
  snspCap: number;
  stale: boolean;
}

export interface CoordinatorInput {
  overloadsN: number;
  overloadsN1: number;
  worstN1: number;
  snsp: number;
  snspCap: number;
  curtailedMW: number;
  staleShare: number;
  unservedMW: number;
}
