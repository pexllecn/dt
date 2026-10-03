import type { ScenarioId } from './scenarios';
import type { DayResult } from './engine';
import type { AgentDay, AgentInfo } from '@/agents/engine';
import type { StudyBundle } from './studies';
import type { Corridor } from './corridors';

export interface SimInputs {
  scenario: ScenarioId;
  /** "still" (0.2) .. "gale" (1.8) multiplier on the scenario wind. */
  windScale: number;
  /** 2026 .. 2034 */
  year: number | null;
  /** Interconnector share of capacity: -1 export .. +1 import; null = scenario default. */
  icShare: number | null;
  /** Extra demand by bus id, MW. */
  extraLoad: Record<string, number>;
  /** Branch ids out of service all day. */
  outages: string[];
  /** Branch ids that trip part-way through the day. */
  timedOutages: { id: string; fromHour: number }[];
  /** Approved actions applied from an hour onwards. */
  adjustments: { bus: string; deltaMW: number; fromHour: number; windCluster?: number }[];
  /** Communications to Region W lost from this hour (null = none). */
  commsLostFromHour: number | null;
  stalePolicy: 'consistency' | 'availability';
}

export interface BranchMeta {
  id: string;
  label: string;
  kv: number;
  kind: 'line' | 'cable' | 'transformer';
  from: string; // bus id
  to: string;
  circuits: number;
  country: 'ROI' | 'NI' | 'X';
  lengthKm: number;
}

export interface ModelMeta {
  branches: BranchMeta[];
  buses: { id: string; node: string; kv: number; name: string; e: number; n: number }[];
  units: { id: string; name: string; bus: string; capacity: number }[];
  wind: { bus: string; name: string; e: number; n: number }[];
  contingencyLabels: string[];
  agents: AgentInfo[];
  largeLoads: { id: string; name: string; bus: string; hypothetical: boolean }[];
  ruleSetVersion: string;
  ruleSetHash: string;
}

export type ToWorker =
  | { type: 'init'; base: string; inputs: SimInputs }
  | { type: 'inputs'; inputs: SimInputs }
  | { type: 'study'; bus: string; requestMW: number; rangeMW: number };

export type FromWorker =
  | { type: 'ready'; meta: ModelMeta; ms: number }
  | { type: 'day'; day: DayResult; agents: Omit<AgentDay, 'agents'>; corridors: Corridor[] | null; inputs: SimInputs; ms: number }
  | { type: 'study'; bundle: StudyBundle }
  | { type: 'error'; message: string };
