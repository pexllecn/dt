/**
 * Component registry. Initial values are the prototype's `def` values; scenarios (including
 * reset) then mutate them exactly as before. The engineering preset adds T4, the bus-section
 * breaker and bay devices, and renames demand to match what it represents.
 */
import { BASELINE, RATINGS } from '../config/assumptions.ts';
import type {
  BayDevices, Battery, BorderTie, Bus, BusSection, ComponentId, Generator, Grid, Load, Preset,
  Registry, Section, Tie, Transformer,
} from './types.ts';

const bay = (lineBay: boolean): BayDevices => ({ dsBus: true, dsLine: true, es: lineBay ? false : null });

function common(id: ComponentId, name: string, kv: string, note: string, section: Section | null, b: BayDevices | null) {
  return {
    id, name, kv, note, section, bay: b,
    installed: true, closed: true, tripped: false, tripCause: null, live: false, mwNow: 0, dir: 0 as const,
  };
}

function tx(id: 'T1' | 'T2' | 'T3' | 'T4', name: string, kv: string, cap: number, temp: number,
  section: Section | null, coolingType: 'OFAF' | 'ONAF', note: string): Transformer {
  return {
    ...common(id, name, kv, note, section, bay(false)), kind: 'tx', cap, loadPU: 0, temp, topOil: temp, dh1: 0, dh2: 0,
    cool: false, stage: 0, coolingType, pumpFailed: false, drift: 0, ot: 0, ocTimer: 0, ageingRate: 0, ageingHours: 0,
    alarms: { wti: false, oti: false },
  };
}

function gen(id: 'WIND' | 'SOLAR' | 'GAS', unit: Generator['unit'], name: string, cap: number, out: number, avail: number,
  installed: boolean, section: Section, note: string): Generator {
  return {
    ...common(id, name, '220 kV', note, section, bay(false)), kind: 'gen', unit, src: unit === 'gas' ? 'fossil' : 'renew',
    cap, out, avail, actual: Math.min(out, avail), installed, closed: installed,
    windSpeed: 0, windTarget: 0, windRamp: 0, cutOut: false, gasState: 'off', gasTimer: 0,
  };
}

function load(id: 'LD_TOWN' | 'LD_NEW' | 'LD_IND', name: string, kv: string, mw: number, homes: number, installed: boolean,
  section: Section | null, note: string): Load {
  return { ...common(id, name, kv, note, section, bay(false)), kind: 'load', mw, actual: mw, ramp: 0, homes, installed, closed: installed };
}

export function createRegistry(preset: Preset): Registry {
  const eng = preset === 'engineering';
  const GRID: Grid = { ...common('GRID', eng ? '400 kV infeed' : 'National Grid infeed', '400 kV',
    'Two 400 kV circuits from the transmission system. Makes up any shortfall within its import and export limits.', null, bay(true)),
  kind: 'grid', cap: RATINGS.gridImport.value };
  const busNote = 'Tubular aluminium busbar on post insulators.';
  const BUS400: Bus = { ...common('BUS400', '400 kV busbar', '400 kV', busNote, null, null), kind: 'bus' };
  const BUS220A: Bus = { ...common('BUS220A', eng ? '220 kV busbar, section A' : '220 kV Busbar', '220 kV', busNote, 'A', null), kind: 'bus' };
  const BUS220B: Bus = { ...common('BUS220B', '220 kV busbar, section B', '220 kV', busNote, 'B', null), kind: 'bus' };
  const BS220: BusSection = { ...common('BS220', '220 kV bus-section breaker', '220 kV',
    'Joins the two halves of the 220 kV busbar. Bus-zone protection opens it to isolate a faulted section.', null, bay(false)), kind: 'bussection' };
  const BUS110: Bus = { ...common('BUS110', '110 kV busbar', '110 kV', busNote, null, null), kind: 'bus' };

  const T1 = tx('T1', 'Transformer T1', '400/220 kV', RATINGS.T1.value, 28, 'A', 'OFAF',
    'Autotransformer with delta tertiary. Forced-oil cooling with two fan stages.');
  const T2 = tx('T2', 'Transformer T2', '400/220 kV', RATINGS.T2.value, 28, 'B', 'OFAF',
    'Autotransformer with delta tertiary. Forced-oil cooling with two fan stages.');
  const T3 = tx('T3', 'Transformer T3', '220/110 kV', RATINGS.T3.value, 26, 'B', 'ONAF',
    'Autotransformer feeding the 110 kV yard. Natural oil with two fan stages.');
  const T4 = tx('T4', 'Transformer T4', '275/220 kV', RATINGS.T4.value, 26, 'B', 'ONAF',
    'Interbus transformer feeding the 275 kV circuit to the border.');
  T4.installed = eng;

  const WIND = gen('WIND', 'wind', 'Ballyhill Wind Farm', RATINGS.wind.value, BASELINE.windDispatched.value,
    BASELINE.windAvailable.value, true, 'A', 'Variable renewable. Output limited by available wind.');
  const SOLAR = gen('SOLAR', 'solar', 'Clonmore Solar Farm', RATINGS.solar.value, 0, 0, false, 'A',
    eng ? 'Daytime renewable. Output follows the sun and cloud cover.' : 'Daytime renewable. Not yet built.');
  const GAS = gen('GAS', 'gas', eng ? 'Peaking gas unit' : 'Peaking Gas Unit', RATINGS.gas.value, 0, RATINGS.gas.value, false, 'A',
    eng ? 'Open-cycle gas turbine. Dispatchable but not renewable, and takes about 15 minutes to reach full output.'
      : 'Dispatchable but non-renewable.');
  const BESS: Battery = {
    ...common('BESS', 'Battery storage', '220 kV', 'Discharges (+) to supply or charges (-) to absorb. Responds in seconds.', 'B', bay(false)),
    kind: 'bess', src: 'store', cap: RATINGS.battery.value, energyCap: RATINGS.batteryEnergy.value, set: 0,
    soc: BASELINE.batterySoc.value, actual: 0, installed: false, closed: false,
  };
  const LD_TOWN = load('LD_TOWN', eng ? 'Regional demand' : 'Clonmore Town', '220 kV', BASELINE.regionalDemand.value, eng ? 0 : 620000, true, null,
    eng ? 'Towns, villages and commercial load, supplied through two groups of 220 kV circuits, one on each busbar section.'
      : 'Local Irish demand.');
  const LD_NEW = load('LD_NEW', eng ? 'New demand connection' : 'New Ireland Estate', '220 kV', 0, 0, false, 'B',
    eng ? 'A 120 MW mixed commercial and data centre connection.' : 'A new Irish housing and data estate.');
  const LD_IND = load('LD_IND', 'Industrial park', '110 kV', BASELINE.industrialDemand.value, 0, true, null,
    'Continuous industrial demand fed from the 110 kV busbar.');
  const TIE_NI: BorderTie = {
    ...common('TIE_NI', eng ? 'Border tie to Northern Ireland' : 'Cross-border Tie', eng ? '275 kV' : '220 kV',
      eng ? 'Scheduled transfer to Northern Ireland through T4 and a 275 kV circuit. Opens if the island splits.'
        : 'Exports to an estate in Northern Ireland.', eng ? null : 'B', bay(true)),
    kind: 'tie', cap: RATINGS.borderTie.value, mw: BASELINE.borderTransfer.value, actual: BASELINE.borderTransfer.value,
  };
  const TIE_N: Tie = {
    ...common('TIE_N', eng ? 'Ardnagreany 220 kV' : 'Tie to Ardnagreany Stn', '220 kV',
      'Neighbouring station to the north. Transfers are requested through the National Control Centre.', 'A', bay(true)),
    kind: 'tie2', cap: RATINGS.ardnagreany.value, set: 0, actual: 0,
  };
  const TIE_S: Tie = {
    ...common('TIE_S', eng ? 'Ballyduff 110 kV' : 'Tie to Ballyduff Stn', '110 kV',
      'Neighbouring station to the south, on the 110 kV busbar.', null, bay(true)),
    kind: 'tie2', cap: RATINGS.ballyduff.value, set: 0, actual: 0,
  };

  return { GRID, BUS400, T1, T2, BUS220A, BUS220B, BS220, T3, BUS110, T4, WIND, SOLAR, GAS, BESS, LD_TOWN, LD_NEW, LD_IND, TIE_NI, TIE_N, TIE_S };
}

export const COMPONENT_IDS = Object.keys(createRegistry('engineering')) as ComponentId[];
