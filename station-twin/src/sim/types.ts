/**
 * Simulation types. The registry keeps the prototype's component IDs and fields
 * (closed, tripped, live, mwNow, dir, installed) so scenarios port line by line.
 */
export type Preset = 'parity' | 'engineering';
export type Section = 'A' | 'B';
export type Dir = -1 | 0 | 1;
export type CoolingStage = 0 | 1 | 2;

/** Isolating devices of a switchgear bay. The circuit breaker is `closed` on the component. */
export interface BayDevices {
  dsBus: boolean;
  dsLine: boolean;
  /** Earth switch, present on line and cable bays only. */
  es: boolean | null;
}

interface Common {
  id: ComponentId;
  name: string;
  kv: string;
  note: string;
  installed: boolean;
  /** Circuit breaker closed. */
  closed: boolean;
  /** Protection has operated and is locked out until reset. */
  tripped: boolean;
  tripCause: string | null;
  live: boolean;
  mwNow: number;
  dir: Dir;
  /** 220 kV busbar section the bay connects to, or null. */
  section: Section | null;
  bay: BayDevices | null;
}

export interface Grid extends Common { kind: 'grid'; cap: number }
export interface Bus extends Common { kind: 'bus' }
export interface BusSection extends Common { kind: 'bussection' }

export interface Transformer extends Common {
  kind: 'tx';
  cap: number;
  /** Load in per unit of nameplate (MW against MVA, see Simplifications). */
  loadPU: number;
  /** Winding hot-spot temperature (°C). In the parity preset, the prototype's single temperature. */
  temp: number;
  topOil: number;
  /** IEC 60076-7 hot-spot rise components (K). */
  dh1: number;
  dh2: number;
  /** Operator has forced all cooling on. */
  cool: boolean;
  stage: CoolingStage;
  coolingType: 'OFAF' | 'ONAF';
  pumpFailed: boolean;
  /** Prototype parity only: added temperature from the cooling-pump fault. */
  drift: number;
  /** Prototype parity only: seconds over limit. */
  ot: number;
  /** Seconds above the backup overcurrent pickup. */
  ocTimer: number;
  ageingRate: number;
  /** Equivalent hours of normal ageing accumulated since reset. */
  ageingHours: number;
  alarms: { wti: boolean; oti: boolean };
}

export type GeneratorUnit = 'wind' | 'solar' | 'gas';
export type GasState = 'off' | 'starting' | 'running';

export interface Generator extends Common {
  kind: 'gen';
  unit: GeneratorUnit;
  src: 'renew' | 'fossil';
  cap: number;
  /** Dispatch set-point (MW). */
  out: number;
  /** Available resource (MW). */
  avail: number;
  /** Output the plant is producing before network gating (engineering preset). */
  actual: number;
  windSpeed: number;
  windTarget: number;
  /** m/s per simulated second. */
  windRamp: number;
  cutOut: boolean;
  gasState: GasState;
  gasTimer: number;
}

export interface Battery extends Common {
  kind: 'bess';
  src: 'store';
  cap: number;
  energyCap: number;
  /** Set-point: + discharge, - charge (MW). */
  set: number;
  soc: number;
  actual: number;
}

export interface Load extends Common {
  kind: 'load';
  /** Demand set-point (MW). */
  mw: number;
  actual: number;
  /** MW per simulated second; 0 steps immediately. */
  ramp: number;
  homes: number;
}

export interface BorderTie extends Common {
  kind: 'tie';
  cap: number;
  /** Scheduled northbound transfer (MW). */
  mw: number;
  actual: number;
}

export interface Tie extends Common {
  kind: 'tie2';
  cap: number;
  /** Requested transfer: + into Clonmore, - out (MW). */
  set: number;
  actual: number;
}

export interface Registry {
  GRID: Grid;
  BUS400: Bus;
  T1: Transformer;
  T2: Transformer;
  BUS220A: Bus;
  BUS220B: Bus;
  BS220: BusSection;
  T3: Transformer;
  BUS110: Bus;
  T4: Transformer;
  WIND: Generator;
  SOLAR: Generator;
  GAS: Generator;
  BESS: Battery;
  LD_TOWN: Load;
  LD_NEW: Load;
  LD_IND: Load;
  TIE_NI: BorderTie;
  TIE_N: Tie;
  TIE_S: Tie;
}

export type ComponentId = keyof Registry;
export type Component = Registry[ComponentId];
export type TransformerId = 'T1' | 'T2' | 'T3' | 'T4';
export type LoadId = 'LD_TOWN' | 'LD_NEW' | 'LD_IND';
export type BusId = 'BUS400' | 'BUS220A' | 'BUS220B' | 'BUS110';
export const TRANSFORMERS: readonly TransformerId[] = ['T1', 'T2', 'T3', 'T4'];

export interface Sys {
  gridHealthy: boolean;
  /** Faulted 220 kV sections. The parity preset faults both (one busbar). */
  busFault: Section[];
  coupled: boolean;
  shedMW: number;
  /** Prototype parity: storm countdown (s) and frequency shock. */
  storm: number;
  shock: number;
  /** Prototype parity: station frequency and mode. */
  freq: number;
  mode: 'NORMAL' | 'ALERT' | 'EMERGENCY' | 'BLACKOUT';
  reliability: number;
}

export interface Part {
  key: string;
  label: string;
  mw: number;
}

export interface Results {
  gridFlow: number;
  t3Flow: number;
  t4Flow: number;
  supply: number;
  demand: number;
  renewPct: number;
  unbal: number;
  parts: { sup: Part[]; dem: Part[] };
  /** Signed transformer flows, + from the higher to the lower voltage. */
  txFlow: Record<TransformerId, number>;
  /** Flow through the bus-section breaker, + from A to B. */
  bsFlow: number;
  localGeneration: number;
  localDemand: number;
  /** Power balance residual at each node (MW). Zero when the solve is consistent. */
  residuals: Record<'B400' | 'B220A' | 'B220B' | 'B110' | 'B275', number>;
  /** Regional demand supplied by section (MW). */
  regional: { A: number; B: number; offSupply: number };
}

export interface Weather {
  cloud: number;
  storm: boolean;
  rain: number;
}

export type Condition = 'Normal' | 'Alert' | 'Emergency' | 'Supply lost' | 'Restoring';

export interface ContingencyResult {
  /** Loading of T2 if T1 is lost, and vice versa (per unit), or null if not applicable. */
  lossOfT1: number | null;
  lossOfT2: number | null;
  worst: number;
  secure: boolean;
}

export interface FrequencyEvent {
  t: number;
  area: 'all-island' | 'Ireland' | 'Northern Ireland';
  /** Deficit (+) or surplus (-) in MW. */
  deltaMw: number;
  cause: string;
  rocof: number;
  nadir: number;
  quasiSteady: number;
  /** Real-time transient, 0.1 s spacing, Hz. */
  series: number[];
}

export interface FrequencyState {
  coupled: boolean;
  /** Displayed quasi-steady frequency per area (Hz). Equal while coupled. */
  ireland: number;
  ni: number;
  drawIreland: number;
  drawNI: number;
  coverIreland: number;
  coverNI: number;
  events: FrequencyEvent[];
}

export type Device = 'cb' | 'dsBus' | 'dsLine' | 'es';

export interface ProgrammeStep {
  id: ComponentId;
  device: Device;
  action: 'open' | 'close';
}

export interface Programme {
  title: string;
  steps: ProgrammeStep[];
  next: number;
  timer: number;
  status: 'running' | 'done' | 'aborted';
  reason: string | null;
}

export type ScheduledEvent =
  | { at: number; kind: 'trip'; id: ComponentId; cause: string; ifStorm?: boolean }
  | { at: number; kind: 'windRamp'; to: number; minutes: number }
  | { at: number; kind: 'weather'; storm: boolean; cloud: number; rain: number }
  | { at: number; kind: 'stormEnd' };

export interface LogEntry {
  t: number;
  kind: 'scenario' | 'trip' | 'alarm' | 'switching' | 'protection' | 'info';
  id: ComponentId | null;
  text: string;
}

export interface SimState {
  preset: Preset;
  seed: number;
  /** Simulated seconds since the start of the simulation day (engineering) or prototype seconds (parity). */
  t: number;
  steps: number;
  C: Registry;
  sys: Sys;
  results: Results;
  weather: Weather;
  frequency: FrequencyState;
  contingency: ContingencyResult;
  condition: Condition;
  schedule: ScheduledEvent[];
  programme: Programme | null;
  log: LogEntry[];
  /** When set, the clock runs at time-lapse speed until this time is reached. */
  fastForwardTo: number | null;
}
