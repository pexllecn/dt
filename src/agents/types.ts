import type { SourceLabel } from '@/lib/sourced';

/**
 * Agents are deterministic rule evaluators. Every decision on screen can be traced to a rule
 * (id, version, plain-English text), the input values it read, the threshold and the outcome.
 * No model learns or changes at run time: the rule set is frozen and versioned.
 */
export type AssetType = 'line' | 'transformer' | 'substation' | 'windfarm' | 'battery' | 'largeload' | 'interconnector' | 'coordinator';
export type Severity = 'info' | 'advisory' | 'warning' | 'critical';
export type Maturity = 'base' | 'extended';
export type ActionKind = 'alarm' | 'publish' | 'recommend' | 'localSafeMode';

export interface Threshold {
  value: number;
  unit: string;
  source: SourceLabel;
  /** Comparison used by the rule, for display: e.g. '>' or '<='. */
  op: '>' | '>=' | '<' | '<=' | '=';
}

export interface Rule<I> {
  id: string;
  version: string;
  assetType: AssetType;
  maturity: Maturity;
  /** Plain English, shown verbatim in the trace. British English, no em dashes. */
  description: string;
  /** Standard, guide or practice the rule follows, where there is one. */
  reference?: string;
  inputs: (keyof I & string)[];
  threshold: Threshold;
  /** The measured quantity compared against the threshold (shown in the trace). */
  measure: (input: I) => number;
  condition: (input: I, threshold: number) => boolean;
  action: ActionKind;
  severity: Severity;
  /** What the agent does or publishes when the rule fires, in plain English. */
  outcome: string;
  /** Examples that must fire and must not fire: every rule is unit tested from these. */
  examples: { fires: I[]; quiet: I[] };
  /** Rules that only make sense on fresh data are suspended when comms are lost. */
  needsFreshData?: boolean;
}

/** Helper that infers the input type and freezes the rule. */
export function defineRules<I>(assetType: AssetType, rules: Omit<Rule<I>, 'assetType'>[]): Rule<I>[] {
  return rules.map((r) => Object.freeze({ ...r, assetType }) as Rule<I>);
}

export const cmp = (op: Threshold['op'], a: number, b: number): boolean =>
  op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b : op === '<=' ? a <= b : a === b;

/** Standard condition: measure compared against the threshold with its operator. */
export function byThreshold<I>(measure: (i: I) => number, op: Threshold['op']) {
  return (i: I, t: number) => cmp(op, measure(i), t);
}

export interface TraceEntry {
  seq: number;
  step: number; // 15-minute interval
  agentId: string;
  agentType: AssetType;
  agentName: string;
  ruleId: string;
  ruleVersion: string;
  ruleText: string;
  maturity: Maturity;
  severity: Severity;
  event: 'fired' | 'cleared' | 'published' | 'stale' | 'recommendation' | 'decision';
  /** Input values the rule read, rounded for display. */
  inputs: Record<string, number | string | boolean>;
  measure: number;
  threshold: Threshold;
  outcome: string;
  /** Asset location for fly-to (ITM metres). */
  e: number;
  n: number;
  /** Branch or bus the agent watches, for highlighting. */
  ref?: string;
  stale?: boolean;
}
