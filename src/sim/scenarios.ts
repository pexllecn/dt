import type { WindFront } from './wind';

/**
 * Scenario definitions shared by the worker and the Director. Wind references are hub-height
 * speeds (m/s) through the day before site exposure. Full Director scripts come in M6.
 */
export type ScenarioId = 'today' | 'hero' | 'storm' | 'y2034';

export interface ScenarioDef {
  id: ScenarioId;
  title: string;
  date: { y: number; m: number; d: number };
  year: number;
  icShare: number;
  seed: number;
  windRef: (h: number) => number;
  front?: WindFront;
}

export const scenarios: Record<ScenarioId, ScenarioDef> = {
  today: {
    id: 'today',
    title: 'The grid today',
    date: { y: 2026, m: 10, d: 14 },
    year: 2026,
    icShare: 0.2,
    seed: 7,
    windRef: (h) => 8.2 + 2.6 * Math.sin(((h - 15) / 24) * 2 * Math.PI),
  },
  hero: {
    id: 'hero',
    title: 'A 50 MW connection request in the north west',
    date: { y: 2026, m: 10, d: 14 },
    year: 2026,
    icShare: 0.2,
    seed: 7,
    windRef: (h) => 8.2 + 2.6 * Math.sin(((h - 15) / 24) * 2 * Math.PI),
  },
  storm: {
    id: 'storm',
    title: 'Storm event',
    date: { y: 2026, m: 11, d: 18 },
    year: 2026,
    icShare: -0.3,
    seed: 21,
    windRef: (h) => 9 + 2 * Math.sin(((h - 10) / 24) * 2 * Math.PI),
    front: { arrivalHour: 9, speedKmh: 45, boost: 12, widthKm: 60 },
  },
  y2034: {
    id: 'y2034',
    title: '2034',
    date: { y: 2034, m: 1, d: 18 },
    year: 2034,
    icShare: 0.3,
    seed: 34,
    windRef: (h) => 7 + 1.5 * Math.sin(((h - 16) / 24) * 2 * Math.PI),
  },
};
