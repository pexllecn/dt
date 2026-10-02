import { create } from 'zustand';
import type { ThemeId } from '@/config/themes';

export type Backend = 'webgpu' | 'webgl';
export type Quality = 'high' | 'medium' | 'low';

export interface WorldState {
  theme: ThemeId;
  /** Scenario date (local Irish calendar date). */
  date: { y: number; m: number; d: number };
  /** Local clock time in hours (0..24). */
  hours: number;
  /** Time-lapse rate in simulated hours per real second (0 = paused). */
  timeRate: number;
  debug: boolean;
  backend: Backend | null;
  quality: Quality;
  ready: boolean;
  loadingMessage: string;
  setTheme(t: ThemeId): void;
  toggleTheme(): void;
  setHours(h: number): void;
  setTimeRate(r: number): void;
  toggleDebug(): void;
  setBackend(b: Backend): void;
  setReady(r: boolean, message?: string): void;
}

const params = new URLSearchParams(location.search);
const initialTheme = (params.get('theme') === 'control' ? 'control' : 'specimen') as ThemeId;
const initialHours = params.has('hours') ? Number(params.get('hours')) : 14.5;

export const useWorld = create<WorldState>((set) => ({
  theme: initialTheme,
  date: { y: 2026, m: 10, d: 14 },
  hours: initialHours,
  timeRate: 0,
  debug: params.has('debug'),
  backend: null,
  quality: (params.get('quality') as Quality) ?? 'high',
  ready: false,
  loadingMessage: 'Preparing the island',
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'specimen' ? 'control' : 'specimen' })),
  setHours: (hours) => set({ hours: ((hours % 24) + 24) % 24 }),
  setTimeRate: (timeRate) => set({ timeRate }),
  toggleDebug: () => set((s) => ({ debug: !s.debug })),
  setBackend: (backend) => set({ backend }),
  setReady: (ready, loadingMessage) => {
    (window as unknown as { __twinReady?: boolean }).__twinReady = ready;
    set((s) => ({ ready, loadingMessage: loadingMessage ?? s.loadingMessage }));
  },
}));

/** Frame statistics, written by the render loop and read by the debug overlay (not reactive). */
export const frameStats = {
  fps: 0,
  frameMs: 0,
  gpuMs: 0,
  drawCalls: 0,
  triangles: 0,
  terrainNodes: 0,
  altitude: 0,
  exaggeration: 2.5,
};
