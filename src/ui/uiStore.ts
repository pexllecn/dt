import { create } from 'zustand';
import type { AssetType, Severity } from '@/agents/types';

export interface AuditEntry {
  at: string; // wall clock ISO
  simHour: number;
  scenario: string;
  operator: string;
  decision: 'approved' | 'rejected' | 'modified and approved';
  recommendationId: string;
  title: string;
  actions: { assetName: string; deltaMW: number }[];
  ruleSetVersion: string;
  ruleSetHash: string;
  inputsHash: string;
  note?: string;
}

export interface UiState {
  feedOpen: boolean;
  types: Set<AssetType>;
  minSeverity: Severity;
  maturity: 'base' | 'extended';
  selectedBranch: string | null;
  selectedAgent: string | null;
  notesOpen: boolean;
  /** Map tool: Hand selects, Cut trips a circuit, Load adds 50 MW at a station, Restore returns a circuit. */
  tool: 'hand' | 'cut' | 'load' | 'restore';
  /** Narration panel (templated text, optionally rephrased by an LLM). */
  narrationOn: boolean;
  auditOpen: boolean;
  governanceOpen: boolean;
  decisions: Record<string, AuditEntry['decision']>;
  audit: AuditEntry[];
  flyTo: { e: number; n: number; distance: number; seq: number } | null;
  toast: { text: string; seq: number } | null;
  /** Hero connection request: firmness dial (MW), evidence pack open, offer decision. */
  hero: { dialMW: number | null; evidenceOpen: boolean; decision: AuditEntry['decision'] | null; offeredMW: number | null };
  set(patch: Partial<UiState>): void;
  toggleType(t: AssetType): void;
  record(entry: AuditEntry): void;
  fly(e: number, n: number, distance?: number): void;
  say(text: string): void;
}

export const ALL_TYPES: AssetType[] = ['line', 'transformer', 'substation', 'windfarm', 'battery', 'largeload', 'interconnector', 'coordinator'];
export const SEVERITIES: Severity[] = ['info', 'advisory', 'warning', 'critical'];
export const sevRank: Record<Severity, number> = { info: 1, advisory: 2, warning: 3, critical: 4 };

let seq = 0;
const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
export const useUi = create<UiState>((set) => ({
  feedOpen: q.has('feed'),
  types: new Set(ALL_TYPES),
  minSeverity: 'advisory',
  maturity: q.get('maturity') === 'base' ? 'base' : 'extended',
  selectedBranch: null,
  selectedAgent: null,
  notesOpen: q.has('notes'),
  tool: 'hand',
  narrationOn: q.has('narration'),
  auditOpen: q.has('audit'),
  governanceOpen: q.has('governance'),
  decisions: {},
  audit: [],
  flyTo: null,
  toast: null,
  hero: { dialMW: null, evidenceOpen: q.has('evidence'), decision: null, offeredMW: null },
  set: (patch) => set(patch),
  toggleType: (t) =>
    set((s) => {
      const types = new Set(s.types);
      if (types.has(t)) types.delete(t);
      else types.add(t);
      return { types };
    }),
  record: (entry) => set((s) => ({ audit: [...s.audit, entry], decisions: { ...s.decisions, [entry.recommendationId]: entry.decision } })),
  fly: (e, n, distance = 6000) => set({ flyTo: { e, n, distance, seq: ++seq } }),
  say: (text) => set({ toast: { text, seq: ++seq } }),
}));

export const fmtHour = (h: number) => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

export const typeLabel: Record<AssetType, string> = {
  line: 'Lines',
  transformer: 'Transformers',
  substation: 'Substations',
  windfarm: 'Wind',
  battery: 'Batteries',
  largeload: 'Large loads',
  interconnector: 'Interconnectors',
  coordinator: 'Coordinator',
};
