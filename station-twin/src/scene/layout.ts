/**
 * Station layout: a declarative description of every busbar, bay and transformer, from which the
 * yard is generated. Plan coordinates in metres: x east, z south, y up. The station origin is the
 * centre of the 220 kV busbar. Dimensions are indicative typical values (see docs/METHOD.md).
 */
import type { ComponentId } from '../sim/types.ts';

export type Voltage = 400 | 275 | 220 | 110;

export interface VoltageSpec {
  /** Phase-to-phase spacing (m). */
  phase: number;
  /** Height of the steel support under each item (m). */
  support: number;
  /** Insulator length (m). */
  insulator: number;
  /** Number of insulator sheds. */
  sheds: number;
  /** Busbar centre-line height (m). */
  busHeight: number;
  /** Line gantry beam height (m). */
  gantry: number;
  /** Scale applied to bay equipment spacing. */
  pitch: number;
}

export const VOLTAGE: Record<Voltage, VoltageSpec> = {
  400: { phase: 6.5, support: 3.2, insulator: 4.0, sheds: 26, busHeight: 12.5, gantry: 22, pitch: 1.0 },
  275: { phase: 5.0, support: 3.0, insulator: 3.0, sheds: 20, busHeight: 10.5, gantry: 18, pitch: 0.85 },
  220: { phase: 4.0, support: 2.6, insulator: 2.4, sheds: 16, busHeight: 9.0, gantry: 15, pitch: 0.72 },
  110: { phase: 2.5, support: 2.5, insulator: 1.3, sheds: 9, busHeight: 6.5, gantry: 11, pitch: 0.5 },
};

/** Terminal height of bay equipment: support plus insulator plus fittings. */
export const terminalHeight = (v: Voltage) => VOLTAGE[v].support + VOLTAGE[v].insulator + 0.6;

export type BayKind = 'line' | 'cable' | 'txHV' | 'txLV' | 'busSection';

export interface Busbar {
  id: ComponentId;
  voltage: Voltage;
  x: number;
  z0: number;
  z1: number;
}

export interface Bay {
  key: string;
  owner: ComponentId;
  label: string;
  kind: BayKind;
  voltage: Voltage;
  /** Busbar centre-line x. */
  busX: number;
  /** Bay centre-line z. */
  z: number;
  /** +1 runs east from the busbar, -1 west. */
  dir: 1 | -1;
  /** Length from busbar to the bay's end (m). */
  length: number;
  /** Transformer-feeder bay that starts at a transformer rather than a busbar. */
  noBusbar?: boolean;
}

export interface TransformerPlacement {
  id: 'T1' | 'T2' | 'T3' | 'T4';
  /** Centre of the tank. */
  x: number;
  z: number;
  /** Side the HV bushings face: -1 west, +1 east. LV faces the other way. */
  hvDir: 1 | -1;
  hv: Voltage;
  lv: Voltage;
  /** Tank length along x, width along z, height (m). */
  size: [number, number, number];
  cooling: 'OFAF' | 'ONAF';
}

const X400 = -150;
const X220 = -28;
const X110 = 78;

export const BUSBARS: Busbar[] = [
  { id: 'BUS400', voltage: 400, x: X400, z0: -76, z1: 44 },
  { id: 'BUS220A', voltage: 220, x: X220, z0: -128, z1: -7 },
  { id: 'BUS220B', voltage: 220, x: X220, z0: 7, z1: 124 },
  { id: 'BUS110', voltage: 110, x: X110, z0: 84, z1: 134 },
];

export const BAYS: Bay[] = [
  // 400 kV: two incoming circuits from the west, two transformer bays to the east.
  { key: 'L400-1', owner: 'GRID', label: '400 kV circuit 1', kind: 'line', voltage: 400, busX: X400, z: -60, dir: -1, length: 56 },
  { key: 'L400-2', owner: 'GRID', label: '400 kV circuit 2', kind: 'line', voltage: 400, busX: X400, z: -28, dir: -1, length: 56 },
  { key: 'T1-HV', owner: 'T1', label: 'T1 400 kV', kind: 'txHV', voltage: 400, busX: X400, z: -28, dir: 1, length: 52 },
  { key: 'T2-HV', owner: 'T2', label: 'T2 400 kV', kind: 'txHV', voltage: 400, busX: X400, z: 28, dir: 1, length: 52 },
  // 220 kV west side: transformer LV bays and T4.
  { key: 'T1-LV', owner: 'T1', label: 'T1 220 kV', kind: 'txLV', voltage: 220, busX: X220, z: -28, dir: -1, length: 50 },
  { key: 'T2-LV', owner: 'T2', label: 'T2 220 kV', kind: 'txLV', voltage: 220, busX: X220, z: 28, dir: -1, length: 50 },
  { key: 'T4-220', owner: 'T4', label: 'T4 220 kV', kind: 'txLV', voltage: 220, busX: X220, z: 96, dir: -1, length: 36 },
  // 220 kV east side, section A (north): overhead lines first, then cable feeders.
  { key: 'WIND', owner: 'WIND', label: 'Ballyhill Wind Farm', kind: 'line', voltage: 220, busX: X220, z: -118, dir: 1, length: 36 },
  { key: 'TIE_N', owner: 'TIE_N', label: 'Ardnagreany', kind: 'line', voltage: 220, busX: X220, z: -100, dir: 1, length: 36 },
  { key: 'SOLAR', owner: 'SOLAR', label: 'Solar farm', kind: 'cable', voltage: 220, busX: X220, z: -82, dir: 1, length: 30 },
  { key: 'GAS', owner: 'GAS', label: 'Gas peaker', kind: 'cable', voltage: 220, busX: X220, z: -64, dir: 1, length: 30 },
  { key: 'REG-A', owner: 'LD_TOWN', label: 'Regional demand 1', kind: 'cable', voltage: 220, busX: X220, z: -46, dir: 1, length: 30 },
  // 220 kV east side, section B (south).
  { key: 'REG-B', owner: 'LD_TOWN', label: 'Regional demand 2', kind: 'cable', voltage: 220, busX: X220, z: 30, dir: 1, length: 30 },
  { key: 'LD_NEW', owner: 'LD_NEW', label: 'New connection', kind: 'cable', voltage: 220, busX: X220, z: 48, dir: 1, length: 30 },
  { key: 'BESS', owner: 'BESS', label: 'Battery', kind: 'cable', voltage: 220, busX: X220, z: 66, dir: 1, length: 30 },
  { key: 'T3-220', owner: 'T3', label: 'T3 220 kV', kind: 'txHV', voltage: 220, busX: X220, z: 109, dir: 1, length: 44 },
  // 275 kV: T4 to the border circuit.
  { key: 'T4-275', owner: 'TIE_NI', label: 'Border 275 kV', kind: 'line', voltage: 275, busX: -79, z: 96, dir: -1, length: 42, noBusbar: true },
  // 110 kV.
  { key: 'T3-110', owner: 'T3', label: 'T3 110 kV', kind: 'txLV', voltage: 110, busX: X110, z: 109, dir: -1, length: 46 },
  { key: 'LD_IND', owner: 'LD_IND', label: 'Industrial park', kind: 'cable', voltage: 110, busX: X110, z: 94, dir: 1, length: 22 },
  { key: 'TIE_S', owner: 'TIE_S', label: 'Ballyduff', kind: 'line', voltage: 110, busX: X110, z: 124, dir: 1, length: 28 },
];

export const BUS_SECTION = { owner: 'BS220' as ComponentId, x: X220, z: 0, voltage: 220 as Voltage };

export const TRANSFORMERS: TransformerPlacement[] = [
  { id: 'T1', x: -87, z: -28, hvDir: -1, hv: 400, lv: 220, size: [10, 4.6, 5.2], cooling: 'OFAF' },
  { id: 'T2', x: -87, z: 28, hvDir: -1, hv: 400, lv: 220, size: [10, 4.6, 5.2], cooling: 'OFAF' },
  { id: 'T4', x: -72, z: 96, hvDir: -1, hv: 275, lv: 220, size: [8, 4.0, 4.6], cooling: 'ONAF' },
  { id: 'T3', x: 25, z: 109, hvDir: -1, hv: 220, lv: 110, size: [7.5, 3.8, 4.4], cooling: 'ONAF' },
];

/** Perimeter fence, plan rectangle [x0, z0, x1, z1]. */
export const FENCE: [number, number, number, number] = [-232, -150, 118, 150];
export const CONTROL_BUILDING = { x: 62, z: -40, w: 34, d: 14, h: 6 };

/** Where the camera looks by default, and the yard's bounding radius. */
export const YARD_CENTRE: [number, number, number] = [-55, 0, 0];
export const YARD_RADIUS = 210;
