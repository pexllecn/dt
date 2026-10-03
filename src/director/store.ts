import { create } from 'zustand';
import type { ScenarioId } from '@/sim/scenarios';

export type Mode = 'director' | 'explore';

export interface DirectorState {
  mode: Mode;
  script: ScenarioId;
  beat: number;
  playing: boolean;
  /** Bumped on every beat entry so the Director re-applies it even for the same index. */
  seq: number;
  /** Seconds spent in the current beat while playing. */
  elapsed: number;
  /** A beat that waits for a person (an approval) holds here. */
  waiting: boolean;
  set(patch: Partial<DirectorState>): void;
  go(beat: number): void;
  load(script: ScenarioId, beat?: number): void;
}

const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const explicit = q.get('mode');
// Deep links that set the view or scenario start in Explore unless Director is asked for.
const deepLink = q.has('view') || q.has('scenario') || q.has('bench') || q.has('cave');
const initialMode: Mode = explicit === 'director' ? 'director' : explicit === 'explore' || deepLink ? 'explore' : 'director';
const scriptParam = q.get('script') as ScenarioId | null;

export const useDirector = create<DirectorState>((set, get) => ({
  mode: initialMode,
  script: scriptParam ?? 'today',
  beat: Number(q.get('beat') ?? 0),
  playing: q.has('play'),
  seq: 0,
  elapsed: 0,
  waiting: false,
  set: (patch) => set(patch),
  go: (beat) => set({ beat, seq: get().seq + 1, elapsed: 0, waiting: false }),
  load: (script, beat = 0) => set({ script, beat, seq: get().seq + 1, elapsed: 0, waiting: false }),
}));
