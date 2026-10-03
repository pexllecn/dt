/**
 * The single-line diagram, hand-authored for typographic quality (as the prototype's was), in
 * the same plan coordinates as the yard so the station folds into it in place. North is up the
 * screen: the 400 kV rail at the top, 220 kV in the middle, 110 kV below.
 */
import type { ComponentId, Device } from '../sim/types.ts';
import type { Voltage } from './layout.ts';

export type P2 = [number, number];
export type FeederEnd = 'line' | 'gen' | 'load' | 'bess' | null;

export interface Rail { id: ComponentId; voltage: Voltage; z: number; x0: number; x1: number }
export interface Feeder {
  /** Flow path key (bay key or 'BS220'). */
  key: string;
  owner: ComponentId;
  voltage: Voltage;
  /** From the busbar (or transformer, for the 275 kV bay) outward. */
  pts: P2[];
  /** Switching devices along the feeder, at fractions of its length. */
  devices: { device: Exclude<Device, 'es'>; at: number }[];
  end: FeederEnd;
}

const Z400 = -130;
const Z220 = -20;
const Z110 = 70;
/** Transformer symbol: two overlapping circles, centres a half-gap either side of zc. */
export const TX_R = 7;
export const TX_GAP = 9;
const top = (zc: number) => zc - TX_GAP / 2 - TX_R;
const bot = (zc: number) => zc + TX_GAP / 2 + TX_R;

export const SCHEM_TX: { id: 'T1' | 'T2' | 'T3' | 'T4'; x: number; zc: number }[] = [
  { id: 'T1', x: -110, zc: -75 },
  { id: 'T2', x: 110, zc: -75 },
  { id: 'T3', x: 180, zc: 25 },
  { id: 'T4', x: 330, zc: 25 },
];
const tx = (id: string) => SCHEM_TX.find((t) => t.id === id)!;

export const RAILS: Rail[] = [
  { id: 'BUS400', voltage: 400, z: Z400, x0: -290, x1: 140 },
  { id: 'BUS220A', voltage: 220, z: Z220, x0: -310, x1: -60 },
  { id: 'BUS220B', voltage: 220, z: Z220, x0: -10, x1: 345 },
  { id: 'BUS110', voltage: 110, z: Z110, x0: 160, x1: 290 },
];

const LINE = [{ device: 'dsBus' as const, at: 0.18 }, { device: 'cb' as const, at: 0.45 }, { device: 'dsLine' as const, at: 0.72 }];
const TXB = [{ device: 'dsBus' as const, at: 0.25 }, { device: 'cb' as const, at: 0.62 }];
const down = (x: number, z0: number, len = 45): P2[] => [[x, z0], [x, z0 + len]];
const up = (x: number, z0: number, len = 45): P2[] => [[x, z0], [x, z0 - len]];

export const FEEDERS: Feeder[] = [
  { key: 'L400-1', owner: 'GRID', voltage: 400, pts: up(-260, Z400), devices: LINE, end: 'line' },
  { key: 'L400-2', owner: 'GRID', voltage: 400, pts: up(-200, Z400), devices: LINE, end: 'line' },
  { key: 'T1-HV', owner: 'T1', voltage: 400, pts: [[-110, Z400], [-110, top(tx('T1').zc)]], devices: TXB, end: null },
  { key: 'T2-HV', owner: 'T2', voltage: 400, pts: [[110, Z400], [110, top(tx('T2').zc)]], devices: TXB, end: null },
  { key: 'T1-LV', owner: 'T1', voltage: 220, pts: [[-110, Z220], [-110, bot(tx('T1').zc)]], devices: TXB, end: null },
  { key: 'T2-LV', owner: 'T2', voltage: 220, pts: [[110, Z220], [110, bot(tx('T2').zc)]], devices: TXB, end: null },
  { key: 'WIND', owner: 'WIND', voltage: 220, pts: down(-290, Z220), devices: LINE, end: 'gen' },
  { key: 'TIE_N', owner: 'TIE_N', voltage: 220, pts: down(-250, Z220), devices: LINE, end: 'line' },
  { key: 'SOLAR', owner: 'SOLAR', voltage: 220, pts: down(-210, Z220), devices: LINE, end: 'gen' },
  { key: 'GAS', owner: 'GAS', voltage: 220, pts: down(-170, Z220), devices: LINE, end: 'gen' },
  { key: 'REG-A', owner: 'LD_TOWN', voltage: 220, pts: down(-130, Z220), devices: LINE, end: 'load' },
  { key: 'BS220', owner: 'BS220', voltage: 220, pts: [[-60, Z220], [-10, Z220]], devices: [{ device: 'dsBus', at: 0.2 }, { device: 'cb', at: 0.5 }, { device: 'dsLine', at: 0.8 }], end: null },
  { key: 'REG-B', owner: 'LD_TOWN', voltage: 220, pts: down(10, Z220), devices: LINE, end: 'load' },
  { key: 'LD_NEW', owner: 'LD_NEW', voltage: 220, pts: down(50, Z220), devices: LINE, end: 'load' },
  { key: 'BESS', owner: 'BESS', voltage: 220, pts: down(90, Z220), devices: LINE, end: 'bess' },
  { key: 'T3-220', owner: 'T3', voltage: 220, pts: [[180, Z220], [180, top(tx('T3').zc)]], devices: TXB, end: null },
  { key: 'T4-220', owner: 'T4', voltage: 220, pts: [[330, Z220], [330, top(tx('T4').zc)]], devices: TXB, end: null },
  { key: 'T3-110', owner: 'T3', voltage: 110, pts: [[180, Z110], [180, bot(tx('T3').zc)]], devices: TXB, end: null },
  { key: 'LD_IND', owner: 'LD_IND', voltage: 110, pts: down(220, Z110, 40), devices: LINE, end: 'load' },
  { key: 'TIE_S', owner: 'TIE_S', voltage: 110, pts: down(260, Z110, 40), devices: LINE, end: 'line' },
  { key: 'T4-275', owner: 'TIE_NI', voltage: 275, pts: [[330, bot(tx('T4').zc)], [330, Z110 + 40]], devices: [{ device: 'cb', at: 0.35 }, { device: 'dsLine', at: 0.7 }], end: 'line' },
];

/** The view that frames the whole diagram from above. */
export const SCHEM_CENTRE: P2 = [17, -30];
export const SCHEM_EXTENT: P2 = [700, 380];

/** Where each component's label sits in the diagram (alternating rows so neighbours do not collide). */
export function schematicAnchors(): Map<ComponentId, [number, number, number]> {
  const a = new Map<ComponentId, [number, number, number]>();
  const y = 1;
  for (const t of SCHEM_TX) a.set(t.id, [t.x - 36, y, t.zc + 4]);
  for (const r of RAILS) a.set(r.id, [r.x0 + 34, y, r.z - 4]);
  a.set('BS220', [-35, y, Z220 - 8]);
  const below = FEEDERS.filter((f) => f.end && f.pts[1]![1] > f.pts[0]![1]).sort((p, q) => p.pts[0]![0] - q.pts[0]![0]);
  below.forEach((f, i) => {
    const [x, z] = f.pts[f.pts.length - 1]!;
    if (!a.has(f.owner)) a.set(f.owner, [x, y, z + (i % 2 === 0 ? 22 : 40)]);
  });
  // The 400 kV infeed: one label between its two circuits.
  a.set('GRID', [-230, y, Z400 - 58]);
  return a;
}
