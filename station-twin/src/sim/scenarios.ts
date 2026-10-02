/**
 * The scenario library: every scenario from the prototype, with the same IDs and groups.
 *
 * Each scenario has two implementations:
 *  - parity: the prototype's mutation, unchanged, so the parity tests can compare like with like;
 *  - engineering: the same intent with realistic dynamics (ramps, start-up times, scheduled
 *    events on the simulation clock instead of setTimeout) and the engineering topology.
 */
import { PLANT, RATINGS, SITE } from '../config/assumptions.ts';
import { sunPosition } from './plant/sun.ts';
import { windSpeedFor } from './plant/wind.ts';
import { trip } from './protection.ts';
import type { ComponentId, SimState } from './types.ts';

export type ScenarioId =
  | 'ie_estate' | 'ni_estate' | 'ind_exp'
  | 'add_solar' | 'add_bess' | 'add_gas' | 'wind_up' | 'wind_dn' | 'sun_set'
  | 'imp_n' | 'exp_s' | 'nbr_off'
  | 'peak' | 'split' | 'n1' | 'busfault' | 'cool_fail' | 'storm'
  | 'reset';

export type ScenarioGroup = 'Growth and new connections' | 'Generation mix' | 'Neighbouring stations' | 'Network events and faults' | 'Reset';
export type Severity = 'info' | 'advisory' | 'warning' | 'critical';

export interface ScenarioMeta {
  id: ScenarioId;
  group: ScenarioGroup;
  title: string;
  description: string;
  severity: Severity;
  /** Line icon name in the UI icon set. */
  icon: string;
}

export interface ScenarioOutcome {
  title: string;
  detail: string;
}

export const SCENARIOS: readonly ScenarioMeta[] = [
  { id: 'ie_estate', group: 'Growth and new connections', title: 'New demand connection', description: '120 MW connects to the 220 kV busbar', severity: 'advisory', icon: 'building' },
  { id: 'ni_estate', group: 'Growth and new connections', title: 'Northern Ireland demand growth', description: 'Northbound transfer rises by 90 MW', severity: 'advisory', icon: 'arrow-up-right' },
  { id: 'ind_exp', group: 'Growth and new connections', title: 'Industrial expansion', description: '60 MW more on the 110 kV busbar', severity: 'advisory', icon: 'factory' },
  { id: 'add_solar', group: 'Generation mix', title: 'Build the solar farm', description: '150 MW, output follows the sun', severity: 'info', icon: 'sun' },
  { id: 'add_bess', group: 'Generation mix', title: 'Build battery storage', description: '100 MW, 400 MWh', severity: 'info', icon: 'battery' },
  { id: 'add_gas', group: 'Generation mix', title: 'Build a gas peaker', description: '180 MW open-cycle gas turbine', severity: 'info', icon: 'flame' },
  { id: 'wind_up', group: 'Generation mix', title: 'Wind surge', description: 'Wind rises to rated speed', severity: 'info', icon: 'wind' },
  { id: 'wind_dn', group: 'Generation mix', title: 'Wind lull', description: 'Wind output falls to about 30 MW', severity: 'advisory', icon: 'wind-low' },
  { id: 'sun_set', group: 'Generation mix', title: 'Sunset', description: 'Time-lapse to sunset', severity: 'advisory', icon: 'sunset' },
  { id: 'imp_n', group: 'Neighbouring stations', title: 'Request transfer from Ardnagreany', description: '150 MW in from the north', severity: 'info', icon: 'arrow-down-left' },
  { id: 'exp_s', group: 'Neighbouring stations', title: 'Transfer to Ballyduff', description: '120 MW out to the south', severity: 'info', icon: 'arrow-down-right' },
  { id: 'nbr_off', group: 'Neighbouring stations', title: 'End transfers', description: 'Both neighbour transfers to zero', severity: 'info', icon: 'circle-slash' },
  { id: 'peak', group: 'Network events and faults', title: 'Evening demand peak', description: 'Regional demand rises by 180 MW', severity: 'warning', icon: 'trending-up' },
  { id: 'split', group: 'Network events and faults', title: 'System split', description: 'Ireland and Northern Ireland separate', severity: 'critical', icon: 'split' },
  { id: 'n1', group: 'Network events and faults', title: 'Loss of T1 (N-1)', description: 'Protection trips transformer T1', severity: 'critical', icon: 'zap-off' },
  { id: 'busfault', group: 'Network events and faults', title: '220 kV earth fault', description: 'Bus-zone protection isolates section B', severity: 'critical', icon: 'busbar-fault' },
  { id: 'cool_fail', group: 'Network events and faults', title: 'T1 oil pump failure', description: 'Cooling degrades without an alarm', severity: 'warning', icon: 'thermometer' },
  { id: 'storm', group: 'Network events and faults', title: 'Storm front', description: 'High wind and lightning', severity: 'critical', icon: 'cloud-lightning' },
  { id: 'reset', group: 'Reset', title: 'Reset to baseline', description: 'A normal day at 12:00', severity: 'info', icon: 'rotate-ccw' },
];

export const scenarioMeta = (id: ScenarioId): ScenarioMeta => {
  const m = SCENARIOS.find((s) => s.id === id);
  if (!m) throw new Error(`Unknown scenario ${id}`);
  return m;
};

// ---------------------------------------------------------------------------------------
// Parity: the prototype's mutations, unchanged (including the double assignment in n1).
// ---------------------------------------------------------------------------------------

export function runParityScenario(s: SimState, id: ScenarioId): void {
  const { C, sys } = s;
  switch (id) {
    case 'ie_estate': C.LD_NEW.installed = true; C.LD_NEW.closed = true; C.LD_NEW.mw = 120; C.LD_NEW.homes = 150000; break;
    case 'ni_estate': C.TIE_NI.mw += 90; C.TIE_NI.closed = true; sys.coupled = true; break;
    case 'ind_exp': C.LD_IND.mw += 60; break;
    case 'add_solar': C.SOLAR.installed = true; C.SOLAR.closed = true; C.SOLAR.avail = 135; C.SOLAR.out = 135; break;
    case 'add_bess': C.BESS.installed = true; C.BESS.closed = true; C.BESS.set = 0; C.BESS.soc = 60; break;
    case 'add_gas': C.GAS.installed = true; C.GAS.closed = true; C.GAS.avail = 180; C.GAS.out = 0; break;
    case 'wind_up': C.WIND.avail = 200; C.WIND.out = 200; break;
    case 'wind_dn': C.WIND.avail = 30; C.WIND.out = 30; break;
    case 'sun_set': C.SOLAR.avail = 0; C.SOLAR.out = 0; break;
    case 'imp_n': C.TIE_N.closed = true; C.TIE_N.set = 150; break;
    case 'exp_s': C.TIE_S.closed = true; C.TIE_S.set = -120; break;
    case 'nbr_off': C.TIE_N.set = 0; C.TIE_S.set = 0; break;
    case 'peak': C.LD_TOWN.mw += 180; break;
    case 'split': sys.coupled = false; C.TIE_NI.closed = false; sys.shock = 0.22; break;
    case 'n1': C.T1.tripped = true; C.T1.closed = true; C.T1.closed = false; break;
    case 'busfault': sys.busFault = ['A', 'B']; break;
    case 'cool_fail': C.T1.drift = 26; break;
    case 'storm':
      sys.storm = 26; C.WIND.avail = 195; C.WIND.out = 195;
      // The prototype used setTimeout(6000) on wall time; here it is a scheduled event at +6 s.
      s.schedule.push({ at: s.t + 6, kind: 'trip', id: 'T2', cause: 'lightning', ifStorm: true });
      break;
    case 'reset': {
      Object.assign(sys, { gridHealthy: true, busFault: [], coupled: true, shedMW: 0, storm: 0, shock: 0, reliability: 100, freq: 50 });
      for (const t of [C.T1, C.T2, C.T3]) { t.tripped = false; t.closed = true; t.cool = false; t.drift = 0; t.temp = 30; t.ot = 0; }
      C.GRID.closed = true;
      C.WIND.avail = 160; C.WIND.out = 120; C.WIND.closed = true;
      C.SOLAR.installed = false; C.SOLAR.out = 0; C.SOLAR.avail = 0;
      C.GAS.installed = false; C.GAS.out = 0;
      C.BESS.installed = false; C.BESS.set = 0; C.BESS.soc = 55;
      C.LD_TOWN.mw = 480; C.LD_TOWN.closed = true;
      C.LD_NEW.installed = false; C.LD_NEW.mw = 0;
      C.LD_IND.mw = 140; C.LD_IND.closed = true;
      C.TIE_NI.mw = 60; C.TIE_NI.closed = true; C.TIE_NI.tripped = false;
      C.TIE_N.set = 0; C.TIE_N.closed = true; C.TIE_S.set = 0; C.TIE_S.closed = true;
      break;
    }
  }
}

// ---------------------------------------------------------------------------------------
// Engineering: same intent, realistic dynamics.
// ---------------------------------------------------------------------------------------

/** Connect a component: built, isolators closed, breaker closed. */
export function build(s: SimState, id: ComponentId): void {
  const c = s.C[id];
  c.installed = true;
  if (c.bay) { c.bay.dsBus = true; c.bay.dsLine = true; if (c.bay.es !== null) c.bay.es = false; }
  c.closed = true;
  c.tripped = false;
  c.tripCause = null;
}

/** Ramp the wind to a speed that gives `fraction` of capacity, over `minutes` (0 = at once). */
export function windTo(s: SimState, speed: number, minutes: number): void {
  const w = s.C.WIND;
  w.windTarget = speed;
  if (minutes <= 0) { w.windSpeed = speed; w.windRamp = 0; } else w.windRamp = Math.abs(speed - w.windSpeed) / (minutes * 60);
}

/** Next time (s) after `t` at which the sun sets, scanning a day ahead. */
export function nextSunset(t: number): number | null {
  let prev = sunPosition(SITE.epochUtcMs.value, t).elevation;
  for (let x = t + 60; x <= t + 86400; x += 60) {
    const e = sunPosition(SITE.epochUtcMs.value, x).elevation;
    if (prev > -0.833 && e <= -0.833) return x;
    prev = e;
  }
  return null;
}

const BUS_ZONE = 'bus-zone protection, 220 kV section B';
/** Breakers connected to section B that bus-zone protection opens, in restoration order (T2 first, so T1 never carries section B alone). */
export const SECTION_B_BREAKERS: readonly ComponentId[] = ['T2', 'BS220', 'T3', 'T4', 'BESS', 'LD_NEW'];

export function runEngineeringScenario(s: SimState, id: ScenarioId): ScenarioOutcome {
  const { C, sys } = s;
  const m = scenarioMeta(id);
  switch (id) {
    case 'ie_estate':
      build(s, 'LD_NEW'); C.LD_NEW.mw = 120; C.LD_NEW.actual = 120;
      return { title: 'New demand connection (120 MW)', detail: 'A 120 MW mixed commercial and data centre connection is energised on section B. More power flows in through T1 and T2, so watch their loading and the N-1 headroom.' };
    case 'ni_estate':
      C.TIE_NI.mw = Math.min(C.TIE_NI.cap, C.TIE_NI.mw + 90); C.TIE_NI.closed = true; sys.coupled = true;
      return { title: 'Northern Ireland demand growth', detail: 'Demand growth in Northern Ireland raises the scheduled transfer across the border by 90 MW. The National Control Centre ramps it in over about six minutes.' };
    case 'ind_exp':
      C.LD_IND.mw += 60;
      return { title: 'Industrial park expanded (60 MW)', detail: 'The industrial park adds 60 MW on the 110 kV busbar, so more power flows down through T3.' };
    case 'add_solar':
      build(s, 'SOLAR'); C.SOLAR.out = C.SOLAR.cap;
      return { title: 'Solar farm connected (150 MW)', detail: 'Clonmore Solar Farm is connected to section A. Its output follows the sun and cloud cover, so it is strongest around midday and nothing at night.' };
    case 'add_bess':
      build(s, 'BESS'); C.BESS.set = 0; C.BESS.soc = 60;
      return { title: 'Battery connected (100 MW, 400 MWh)', detail: 'The battery is connected to section B. It can absorb surplus renewable output and discharge at the peak, within seconds.' };
    case 'add_gas':
      build(s, 'GAS'); C.GAS.avail = C.GAS.cap; C.GAS.out = 0;
      return { title: 'Gas peaker connected (180 MW)', detail: 'A peaking gas unit is connected to section A. It is dispatchable but not renewable, and needs about 15 minutes from a start command to full output.' };
    case 'wind_up':
      windTo(s, windSpeedFor(1), 20); C.WIND.out = C.WIND.cap;
      return { title: 'Wind rising to 200 MW', detail: 'The wind rises over 20 minutes to the turbines\' rated speed. If local generation exceeds local demand, the station exports and the 400 kV flows reverse.' };
    case 'wind_dn':
      windTo(s, windSpeedFor(30 / RATINGS.wind.value), 20); C.WIND.out = C.WIND.cap;
      return { title: 'Wind falling to about 30 MW', detail: 'The wind drops over 20 minutes. The shortfall comes from the 400 kV system unless the battery or the gas unit covers it.' };
    case 'sun_set': {
      const sunset = nextSunset(s.t);
      if (sunset !== null) s.fastForwardTo = sunset + 10 * 60;
      return { title: 'Running forward to sunset', detail: 'The clock runs forward to just after sunset. Solar output fades with the sun while evening demand builds.' };
    }
    case 'imp_n':
      C.TIE_N.closed = true; C.TIE_N.set = 150;
      return { title: 'Transfer of 150 MW requested from Ardnagreany', detail: 'The National Control Centre redispatches so that 150 MW flows in from Ardnagreany over about 10 minutes. Less is then needed through T1 and T2.' };
    case 'exp_s':
      C.TIE_S.closed = true; C.TIE_S.set = -120;
      return { title: 'Transfer of 120 MW to Ballyduff', detail: 'Clonmore supports Ballyduff with 120 MW. It flows out through T3 and the 110 kV busbar, so T3 loading rises.' };
    case 'nbr_off':
      C.TIE_N.set = 0; C.TIE_S.set = 0;
      return { title: 'Transfers ended', detail: 'Both transfer requests return to zero. Clonmore stands on its local generation and the 400 kV system.' };
    case 'peak':
      C.LD_TOWN.mw += 180; C.LD_TOWN.ramp = 180 / (PLANT.eveningPeakRampMin.value * 60);
      return { title: 'Evening peak: regional demand up 180 MW', detail: 'Regional demand rises by 180 MW over 30 minutes. Both 400/220 kV units load up, and the N-1 headroom shrinks.' };
    case 'split':
      sys.coupled = false; C.TIE_NI.closed = false; C.TIE_NI.actual = 0;
      s.log.push({ t: s.t, kind: 'protection', id: 'TIE_NI', text: 'System separation: the 275 kV border circuit opened.' });
      return { title: 'Ireland and Northern Ireland have separated', detail: 'The 275 kV border circuit opens and the transfer north stops at once. Ireland has a surplus and Northern Ireland a deficit, so their frequencies move apart until reserves act.' };
    case 'n1':
      trip(s, 'T1', 'differential protection (internal fault)');
      return { title: 'Transformer T1 tripped', detail: 'An internal fault has tripped T1. T2 now carries everything the 400 kV system supplies, and its temperature starts to climb.' };
    case 'busfault':
      sys.busFault = ['B'];
      for (const b of SECTION_B_BREAKERS) if (C[b].installed && C[b].closed) trip(s, b, BUS_ZONE);
      return { title: 'Earth fault on 220 kV section B', detail: 'Bus-zone protection has isolated section B. Its circuits, including half of regional demand, T3 and the 110 kV yard, and the border tie, are off supply. Section A stays in service. Re-energisation is blocked until a person confirms the fault is clear.' };
    case 'cool_fail':
      C.T1.pumpFailed = true;
      return { title: 'T1 oil pumps stopped', detail: 'T1\'s oil pumps have stopped and the flow alarm did not operate. T1 now runs hotter than it should for its load. Nothing alarms until a temperature limit is reached.' };
    case 'storm': {
      s.weather = { storm: true, cloud: 0.95, rain: 0.8 };
      windTo(s, windSpeedFor(195 / RATINGS.wind.value), 0);
      C.WIND.out = C.WIND.cap;
      windTo(s, 29, 120);
      s.schedule.push({ at: s.t + 40 * 60, kind: 'trip', id: 'T2', cause: 'lightning flashover at the 400 kV terminals, differential protection', ifStorm: true });
      s.schedule.push({ at: s.t + 180 * 60, kind: 'stormEnd' });
      return { title: 'Storm front arriving', detail: 'A storm front is arriving. The wind rises towards the turbines\' high-wind limit over the next two hours, and lightning is forecast near the station.' };
    }
    case 'reset':
      return { title: m.title, detail: 'Baseline: 480 MW regional demand, 140 MW industrial, 60 MW transfer to Northern Ireland and 120 MW of wind, at 12:00 on Tuesday 10 March.' };
  }
}
