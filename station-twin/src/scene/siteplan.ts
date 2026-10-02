/**
 * The station's surroundings: overhead line routes and the connected plant, in the same plan
 * coordinates as the yard (x east, z south, metres). Geography is compressed for composition
 * (a Simplification): the electrical model has no line impedances, so no number changes.
 */
import type { ComponentId } from '../sim/types.ts';
import type { Voltage } from './layout.ts';

export type TowerType = 'lattice400' | 'lattice275' | 'lattice220' | 'woodpole110';

export interface LineRoute {
  /** Line bay key in the yard, matched to the station's line start. */
  bay: string;
  owner: ComponentId;
  voltage: Voltage;
  tower: TowerType;
  /** Nominal span between towers (m). */
  span: number;
  /** Route waypoints after the terminal tower, ending at the far station or border. */
  route: [number, number][];
  /** Where the line goes, for its far-end label. */
  destination: string;
  /** Distance shown on the far-end label (km), not the compressed scene distance. */
  realKm: number;
}

export const LINES: LineRoute[] = [
  { bay: 'L400-1', owner: 'GRID', voltage: 400, tower: 'lattice400', span: 380, route: [[-700, -110], [-1700, -330], [-3400, -620]], destination: '400 kV transmission system', realKm: 46 },
  { bay: 'L400-2', owner: 'GRID', voltage: 400, tower: 'lattice400', span: 380, route: [[-700, -40], [-1700, -220], [-3400, -520]], destination: '400 kV transmission system', realKm: 46 },
  { bay: 'WIND', owner: 'WIND', voltage: 220, tower: 'lattice220', span: 330, route: [[200, -250], [250, -700], [900, -960]], destination: 'Ballyhill Wind Farm', realKm: 9 },
  { bay: 'TIE_N', owner: 'TIE_N', voltage: 220, tower: 'lattice220', span: 330, route: [[290, -220], [1400, -700], [2600, -1600], [3300, -2700]], destination: 'Ardnagreany', realKm: 22 },
  { bay: 'T4-275', owner: 'TIE_NI', voltage: 275, tower: 'lattice275', span: 350, route: [[-420, 20], [-820, -620], [-1350, -1700], [-1800, -3300]], destination: 'Northern Ireland', realKm: 14 },
  { bay: 'TIE_S', owner: 'TIE_S', voltage: 110, tower: 'woodpole110', span: 190, route: [[290, 200], [620, 900], [980, 2100], [1250, 3600]], destination: 'Ballyduff', realKm: 17 },
];

export interface Rect { x0: number; z0: number; x1: number; z1: number }

export const SITES: Record<'solar' | 'battery' | 'gas' | 'campus' | 'industrial' | 'windfarm' | 'town', Rect> = {
  solar: { x0: 480, z0: 120, x1: 900, z1: 420 },
  battery: { x0: 150, z0: -90, x1: 250, z1: -10 },
  gas: { x0: -360, z0: 150, x1: -270, z1: 240 },
  campus: { x0: 320, z0: -640, x1: 580, z1: -410 },
  industrial: { x0: -700, z0: 500, x1: -280, z1: 840 },
  windfarm: { x0: 300, z0: -2350, x1: 2300, z1: -1000 },
  town: { x0: -1100, z0: 3700, x1: 1000, z1: 4500 },
};

/** The border, as a polyline across the north of the scene. */
export const BORDER: [number, number][] = [[-5200, -2500], [-3000, -2750], [-1500, -2600], [0, -2950], [1500, -3150], [3200, -3000], [5200, -3300]];

/** Where each component's label sits when the camera is out at network scale. */
export const FAR_ANCHORS: Partial<Record<ComponentId, [number, number, number]>> = {
  GRID: [-1700, 110, -280],
  WIND: [1300, 170, -1675],
  SOLAR: [690, 30, 270],
  BESS: [200, 20, -50],
  GAS: [-315, 45, 195],
  LD_NEW: [450, 40, -525],
  LD_IND: [-490, 40, 670],
  LD_TOWN: [-50, 90, 4100],
  TIE_N: [3300, 90, -2700],
  TIE_S: [1250, 70, 3600],
  TIE_NI: [-1650, 120, -2700],
};

/** Areas kept clear of hedgerows and trees. */
export const CLEAR: Rect[] = [
  { x0: -270, z0: -190, x1: 160, z1: 190 },
  ...Object.values(SITES).filter((r) => r !== SITES.windfarm && r !== SITES.town),
];

/** Buried cable routes from the cable bays to the plant they serve (waypoints after leaving the yard). */
export const CABLES: Record<string, [number, number][]> = {
  SOLAR: [[130, -82], [130, -120], [470, -120], [490, 150]],
  GAS: [[-28, 140], [-250, 160]],
  'REG-A': [[-240, -46], [-240, 600], [-250, 3500], [-150, 3750]],
  'REG-B': [[60, 140], [120, 900], [200, 3500], [100, 3760]],
  LD_NEW: [[140, -170], [330, -420]],
  BESS: [[140, 66], [140, -15], [160, -30]],
  LD_IND: [[150, 150], [-60, 420], [-300, 620]],
};

/** Loughs: elliptical basins, water level relative to the surrounding ground. */
export const LOUGHS: { x: number; z: number; rx: number; rz: number; rot: number }[] = [
  { x: -1450, z: 1250, rx: 520, rz: 260, rot: 0.5 },
  { x: 1900, z: 300, rx: 300, rz: 170, rot: -0.3 },
];
