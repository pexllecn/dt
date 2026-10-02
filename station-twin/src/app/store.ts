/** Application state as signals, shared by the UI and the 3D stage. */
import { signal } from '@preact/signals';
import type { CommandResult } from '../sim/engine.ts';
import type { ClockState } from '../sim/protocol.ts';
import type { ComponentId, SimState } from '../sim/types.ts';
import type { Theme } from '../scene/sky.ts';
import type { Lens } from '../scene/stage.ts';
import type { AgentView } from '../agents/types.ts';

export const snap = signal<SimState | null>(null);
export const clock = signal<ClockState>({ compression: 120, effective: 120, paused: false });
export const selected = signal<ComponentId | null>(null);
export const theme = signal<Theme>('daylight');
export const lens = signal<Lens>('physical');
export const agents = signal<AgentView | null>(null);
/** Predicted end states of the newest recommendation's options, for the ghost preview. */
export const previews = signal<{ forRec: string | null; states: Record<string, SimState> }>({ forRec: null, states: {} });
/** Option being previewed (hover), as recommendation and option id. */
export const hovered = signal<{ recId: string; optionId: string } | null>(null);
export const feedOpen = signal(true);
export const auditOpen = signal(false);
/** The operator's label in the audit log. */
export const operator = signal('Duty engineer');
export const dockOpen = signal(true);
export const logOpen = signal(true);
export const debugOpen = signal(false);
export const methodOpen = signal(false);
export const toast = signal<{ result: CommandResult; key: number } | null>(null);
export const confirmReq = signal<{ title: string; body: string; action: string; danger?: boolean; run: () => void } | null>(null);

/** One sample per simulated minute for sparklines (last six hours). */
export const history = new Map<string, { t: number; v: number }[]>();
let lastMinute = -1;
export function recordHistory(s: SimState): void {
  const minute = Math.floor(s.t / 60);
  if (minute === lastMinute) return;
  if (minute < lastMinute) history.clear();
  lastMinute = minute;
  const push = (k: string, v: number) => {
    let l = history.get(k);
    if (!l) history.set(k, (l = []));
    l.push({ t: s.t, v });
    if (l.length > 360) l.shift();
  };
  for (const id of ['T1', 'T2', 'T3', 'T4'] as const) { push(`${id}.temp`, s.C[id].temp); push(`${id}.load`, s.C[id].loadPU * 100); }
  for (const [id, c] of Object.entries(s.C)) push(`${id}.mw`, c.mwNow);
  push('BESS.soc', s.C.BESS.soc);
  push('freq', s.frequency.ireland);
}
