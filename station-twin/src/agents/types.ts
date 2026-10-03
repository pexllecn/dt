/**
 * Agent layer types. Agents are deterministic and explainable: every report comes from a frozen
 * rule with a sourced threshold, every decision is made by a person, and every step is traced.
 */
import type { Sourced } from '../lib/sourced.ts';
import type { Command } from '../sim/engine.ts';
import type { ComponentId } from '../sim/types.ts';

export type Severity = 'info' | 'advisory' | 'warning' | 'critical';
export type AgentAction = 'alarm' | 'publish' | 'recommend';
export type AssetType = 'transformer' | 'busbar' | 'wind' | 'battery' | 'gas' | 'demand' | 'tie' | 'infeed' | 'solar';
export type RuleSetMode = 'base' | 'extended';

export interface Rule<I> {
  id: string;
  version: string;
  assetType: AssetType;
  maturity: 'base' | 'extended';
  /** Plain English, shown verbatim in the trace. */
  description: string;
  reference?: string;
  inputs: (keyof I & string)[];
  threshold: Sourced<number>;
  condition: (input: I, threshold: number) => boolean;
  action: AgentAction;
  severity: Severity;
  /** Partial inputs over the rule set's nominal input; drive one generated test per rule. */
  examples: { fires: Partial<I>[]; quiet: Partial<I>[] };
}

export interface TraceEntry {
  seq: number;
  t: number;
  agent: ComponentId | 'COORD';
  ruleId: string;
  version: string;
  text: string;
  inputs: Record<string, number | boolean | string>;
  threshold: { value: number; unit: string; source: string; label: string } | null;
  outcome: 'fired' | 'cleared' | 'screen' | 'lookahead' | 'decision' | 'tracking';
  severity: Severity;
  /** Method IDs cited by coordinator entries. */
  methods?: string[];
  narration: string;
}

export interface AgentStatus {
  id: ComponentId;
  level: 'calm' | Severity;
  active: string[];
  /** Simulated time of the last change in evaluation. */
  changedT: number;
}

export interface Arc { from: ComponentId; to: ComponentId; t: number }

export interface Sample {
  t: number;
  hotSpot: Record<'T1' | 'T2' | 'T3' | 'T4', number>;
  loadPU: Record<'T1' | 'T2' | 'T3' | 'T4', number>;
  shedMW: number;
  offSupply: number;
  gasMW: number;
  renewPct: number;
  gridMW: number;
  freq: number;
  /** Worst N-1 loading (per unit). */
  n1Worst: number;
}

export type SecurityClass = 'holds' | 'tolerable' | 'fails';

export interface Outcome {
  security: SecurityClass;
  /** Customer impact: MW shed or off supply, times hours. */
  customerMWh: number;
  /** Margin of the peak hot-spot below 120 °C (K, negative when over). */
  hotSpotMargin: number;
  peakHotSpot: number;
  peakLoadPU: number;
  /** Worst N-1 loading over the last quarter of the horizon (per unit). */
  n1End: number;
  /** Mean local renewable share over the horizon (%). */
  renewPct: number;
  fossilMWh: number;
  samples: Sample[];
  /** Index into samples of the predicted end state (for the ghost preview). */
  endState: unknown;
}

export interface Candidate {
  id: string;
  label: string;
  kind: 'cooling' | 'battery' | 'gas' | 'transfer' | 'wind' | 'shed' | 'rebalance' | 'combo' | 'none';
  commands: Command[];
  /** Seconds before the action takes full effect (for the card). */
  delayS: number;
  /** Editable magnitude, for Modify. */
  magnitude?: { value: number; min: number; max: number; step: number; unit: string; label: string };
  /** Text explaining a human-executed step, if any. */
  note?: string;
}

export interface Option extends Candidate {
  rank: number;
  outcome: Omit<Outcome, 'endState'>;
}

export interface Recommendation {
  id: string;
  createdT: number;
  trigger: string;
  focus: ComponentId[];
  problem: 'thermal' | 'balance';
  horizonS: number;
  options: Option[];
  baseline: Omit<Outcome, 'endState'>;
  status: 'pending' | 'approved' | 'rejected' | 'superseded' | 'completed';
  chosen: string | null;
  methods: string[];
  /** Advisory recommendations never act; they inform. */
  advisory: boolean;
}

export interface Tracking {
  recommendationId: string;
  optionId: string;
  startT: number;
  predicted: Sample[];
  /** Largest deviation of actual from predicted so far (K hot-spot, MW grid). */
  maxDeviation: number;
  holds: boolean;
  note: string;
}

export interface AuditEntry {
  seq: number;
  simT: number;
  wallT: string;
  operator: string;
  decision: 'approve' | 'reject' | 'modify' | 'confirm';
  recommendationId: string;
  option: string | null;
  commands: Command[];
  ruleSetHash: string;
  ruleSetMode: RuleSetMode;
  inputHash: string;
  seed: number;
}

export interface EarlyCatch {
  agent: ComponentId;
  /** First extended detection (simulated s), with the rule. */
  extendedT: number | null;
  extendedRule: string | null;
  /** TX-B-02 time: measured when it has fired, otherwise projected by look-ahead. */
  baseT: number | null;
  baseProjected: boolean;
  /** Minutes between the two. */
  gapMin: number | null;
}

export interface ScreenResult {
  t: number;
  items: { contingency: string; worstLoadPU: number; worstAsset: string; secure: boolean; note: string }[];
  secure: boolean;
}

/** What the UI receives with every snapshot. */
export interface AgentView {
  mode: RuleSetMode;
  ruleSetHash: string;
  ruleCount: number;
  feed: TraceEntry[];
  statuses: AgentStatus[];
  arcs: Arc[];
  recommendations: Recommendation[];
  tracking: Tracking | null;
  audit: AuditEntry[];
  screen: ScreenResult | null;
  earlyCatch: EarlyCatch | null;
  /** Predicted end states of the options of the newest pending recommendation, by option id (for the ghost). */
  previews: Record<string, unknown>;
  blocked: { section: string; reason: string } | null;
}

/** A rule of any input type, for code that handles every rule set alike. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRule = Rule<any>;
