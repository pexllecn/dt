/**
 * The simulation engine. Owns the state, advances it on a fixed step, applies commands and
 * reports what changed. Deterministic: no wall clock, no Math.random; every state can be
 * rebuilt from (preset, seed, input log).
 */
import { BASELINE, CLOCK, PLANT, SITE } from '../config/assumptions.ts';
import { hash } from '../lib/hash.ts';
import { approach, clamp } from '../lib/math.ts';
import { applyFlows, computeFlows, inService, type FlowResult } from './balance.ts';
import { contingency, stationCondition } from './condition.ts';
import { frequencyStep, initialFrequency } from './frequency.ts';
import { batteryEnergyStep, batteryPower } from './plant/battery.ts';
import { gasStep } from './plant/gas.ts';
import { solarFraction, sunPosition } from './plant/sun.ts';
import { windFraction, windSpeedFor } from './plant/wind.ts';
import { protectTransformers, trip } from './protection.ts';
import { createRegistry } from './registry.ts';
import {
  build, runEngineeringScenario, runParityScenario, scenarioMeta, SECTION_B_BREAKERS, type ScenarioId,
} from './scenarios.ts';
import {
  operate, outOfServiceSteps, programmeStep, returnToServiceSteps, startProgramme,
} from './switching.ts';
import { ageingRate, ambientAt, coolingMode, iecStep, nextStage } from './thermal/iec60076.ts';
import { parityThermalStep } from './thermal/parity.ts';
import type {
  ComponentId, Device, LoadId, Preset, Results, Section, SimState, Sys, TransformerId,
} from './types.ts';
import { TRANSFORMERS } from './types.ts';

export type Command =
  | { type: 'scenario'; id: ScenarioId }
  | { type: 'operate'; id: ComponentId; device: Device; action: 'open' | 'close' }
  | { type: 'programme'; id: ComponentId; programme: 'outOfService' | 'returnToService' }
  | { type: 'resetProtection'; id: ComponentId; confirmed: boolean }
  | { type: 'clearBusFault'; section: Section; confirmed: boolean }
  | { type: 'forceCooling'; id: TransformerId; on: boolean }
  | { type: 'setGeneration'; id: 'WIND' | 'SOLAR' | 'GAS'; out: number }
  | { type: 'setBattery'; mw: number }
  | { type: 'requestTransfer'; id: 'TIE_N' | 'TIE_S'; mw: number }
  | { type: 'setBorderTransfer'; mw: number }
  | { type: 'setDemand'; id: LoadId; mw: number; rampMinutes?: number }
  | { type: 'setWind'; speed: number; rampMinutes?: number }
  | { type: 'shed'; mw: number }
  | { type: 'build'; id: ComponentId }
  | { type: 'rebalance' }
  | { type: 'couple'; coupled: boolean }
  | { type: 'fastForward'; to: number }
  // Prototype parity only:
  | { type: 'toggle'; id: ComponentId }
  | { type: 'set'; id: ComponentId; field: string; value: number | boolean }
  | { type: 'setSys'; field: 'shedMW'; value: number };

export interface Delta {
  key: string;
  label: string;
  before: number;
  after: number;
  unit: string;
  digits: number;
}

export interface CommandResult {
  ok: boolean;
  reason: string | null;
  title: string;
  detail: string;
  deltas: Delta[];
  /** True if some of the change is still ramping in; deltas then show the settled state. */
  settling: boolean;
}

export interface EngineOptions {
  preset?: Preset;
  seed?: number;
}

interface LoggedCommand {
  t: number;
  cmd: Command;
}

/** Changes that complete within this horizon count as the settled effect of an action. */
const SETTLE_HORIZON_S = 30 * 60;

const initialSys = (): Sys => ({
  gridHealthy: true, busFault: [], coupled: true, shedMW: 0, storm: 0, shock: 0, freq: 50, mode: 'NORMAL', reliability: 100,
});

const emptyResults = (): Results => ({
  gridFlow: 0, t3Flow: 0, t4Flow: 0, supply: 0, demand: 0, renewPct: 0, unbal: 0, parts: { sup: [], dem: [] },
  txFlow: { T1: 0, T2: 0, T3: 0, T4: 0 }, bsFlow: 0, localGeneration: 0, localDemand: 0,
  residuals: { B400: 0, B220A: 0, B220B: 0, B110: 0, B275: 0 }, regional: { A: 0, B: 0, offSupply: 0 },
});

export class Engine {
  s: SimState;
  readonly inputLog: LoggedCommand[] = [];
  private lastFlows: FlowResult | null = null;

  constructor(opts: EngineOptions = {}) {
    this.s = Engine.initialState(opts.preset ?? 'engineering', opts.seed ?? 1);
  }

  get preset(): Preset { return this.s.preset; }

  static initialState(preset: Preset, seed: number): SimState {
    const s: SimState = {
      preset, seed, t: 0, steps: 0, C: createRegistry(preset), sys: initialSys(), results: emptyResults(),
      weather: { cloud: PLANT.baselineCloud.value, storm: false, rain: 0 },
      frequency: initialFrequency(0, 0, true),
      contingency: { lossOfT1: null, lossOfT2: null, worst: 0, secure: true },
      condition: 'Normal', schedule: [], programme: null, log: [], fastForwardTo: null,
    };
    const e = Object.create(Engine.prototype) as Engine;
    e.s = s;
    if (preset === 'parity') {
      // The prototype solves once on load, then the reset scenario runs and solves again.
      e.paritySolve(0.4);
      runParityScenario(s, 'reset');
      e.paritySolve(0.4);
    } else {
      e.engineeringBaseline();
    }
    return s;
  }

  // -------------------------------------------------------------------------------------
  // Parity preset: the prototype's solve(dt) and frame(dt).
  // -------------------------------------------------------------------------------------

  private paritySolve(dt: number): void {
    const { C, sys } = this.s;
    const f = computeFlows(C, sys, 'parity');
    applyFlows(C, f);
    for (const id of ['T1', 'T2', 'T3'] as const) parityThermalStep(C[id], sys, dt);
    if (f.battery.on && f.battery.power !== 0) {
      C.BESS.soc = clamp(C.BESS.soc - (f.battery.power / C.BESS.cap) * dt * 1.6, 0, 100);
    }
    const unbal = f.results.unbal;
    sys.shock *= 0.92;
    const ftarget = 50 - unbal * 0.0032 + sys.shock;
    sys.freq += (ftarget - sys.freq) * Math.min(1, 0.16 * dt * 3);
    this.s.results = f.results;
    const b220 = f.sectionLive.A || f.sectionLive.B;
    const txs = [C.T1, C.T2, C.T3];
    const hot = txs.some((c) => c.live && (c.temp > 84 || c.loadPU > 1.05));
    const warm = txs.some((c) => c.live && (c.temp > 66 || c.loadPU > 0.9));
    const tripped = txs.some((c) => c.tripped);
    if (!b220) sys.mode = 'BLACKOUT';
    else if (tripped || hot || Math.abs(sys.freq - 50) > 0.35) sys.mode = 'EMERGENCY';
    else if (warm || Math.abs(sys.freq - 50) > 0.15 || unbal !== 0) sys.mode = 'ALERT';
    else sys.mode = 'NORMAL';
    this.lastFlows = f;
  }

  private parityFrame(dt: number): void {
    const s = this.s;
    s.t += dt;
    s.steps++;
    this.fireScheduled(1e-9);
    if (s.sys.storm > 0) s.sys.storm -= dt;
    this.paritySolve(dt);
  }

  // -------------------------------------------------------------------------------------
  // Engineering preset.
  // -------------------------------------------------------------------------------------

  private engineeringBaseline(): void {
    const s = this.s;
    s.t = SITE.baselineTime.value;
    const w = s.C.WIND;
    w.windSpeed = windSpeedFor(BASELINE.windAvailable.value / w.cap);
    w.windTarget = w.windSpeed;
    this.updatePlant(0);
    const f = this.refresh();
    s.frequency = initialFrequency(this.drawIreland(f), this.drawNI(f), s.sys.coupled);
    this.settleThermal();
    this.refresh();
  }

  /** Bring transformer temperatures to steady state for the present load and time. */
  private settleThermal(): void {
    const { C } = this.s;
    const ambient = ambientAt(this.s.t % 86400);
    for (const id of TRANSFORMERS) {
      const c = C[id];
      for (let i = 0; i < 72 * 60; i++) this.thermalStep(c.id as TransformerId, ambient, 60);
      c.ageingHours = 0;
    }
  }

  private thermalStep(id: TransformerId, ambient: number, dt: number): void {
    const c = this.s.C[id];
    if (!c.installed) return;
    c.stage = nextStage(c.stage, c.temp, c.cool, c.live);
    const mode = coolingMode(c);
    const next = iecStep({ topOil: c.topOil, dh1: c.dh1, dh2: c.dh2 }, mode, c.loadPU, c.live, ambient, dt);
    c.topOil = next.topOil; c.dh1 = next.dh1; c.dh2 = next.dh2; c.temp = next.hotSpot;
    c.ageingRate = c.live ? ageingRate(c.temp) : 0;
    c.ageingHours += (c.ageingRate * dt) / 3600;
  }

  /** Plant dynamics before the network solve: resources, ramps, start-up, energy limits. */
  private updatePlant(dt: number): void {
    const { C, weather } = this.s;
    const w = C.WIND;
    w.windSpeed = w.windRamp > 0 ? approach(w.windSpeed, w.windTarget, w.windRamp * dt) : w.windTarget;
    const wf = windFraction(w.windSpeed, w.cutOut);
    if (wf.cutOut && !w.cutOut) this.s.log.push({ t: this.s.t, kind: 'protection', id: 'WIND', text: `Ballyhill Wind Farm shut down on high wind (${w.windSpeed.toFixed(1)} m/s).` });
    if (!wf.cutOut && w.cutOut) this.s.log.push({ t: this.s.t, kind: 'info', id: 'WIND', text: 'Ballyhill Wind Farm restarting as the wind eases.' });
    w.cutOut = wf.cutOut;
    w.avail = w.cap * wf.fraction;
    w.actual = Math.min(w.out, w.avail);

    const sol = C.SOLAR;
    const sun = sunPosition(SITE.epochUtcMs.value, this.s.t);
    sol.avail = sol.installed ? sol.cap * solarFraction(sun.elevation, weather.cloud) : 0;
    sol.actual = Math.min(sol.out, sol.avail);

    const g = C.GAS;
    const gasBus = g.section === 'B' ? C.BUS220B.live : C.BUS220A.live;
    gasStep(g, inService(g) && gasBus, dt);

    const b = C.BESS;
    b.actual = inService(b) ? batteryPower(b) : 0;

    const transferRamp = (PLANT.transferRampMwPerMin.value / 60) * dt;
    for (const id of ['TIE_N', 'TIE_S'] as const) {
      const tie = C[id];
      tie.actual = inService(tie) ? (dt === 0 ? tie.actual : approach(tie.actual, clamp(tie.set, -tie.cap, tie.cap), transferRamp)) : 0;
    }
    const ni = C.TIE_NI;
    ni.actual = inService(ni) && this.s.sys.coupled ? (dt === 0 ? ni.actual : approach(ni.actual, clamp(ni.mw, 0, ni.cap), transferRamp)) : 0;

    for (const id of ['LD_TOWN', 'LD_NEW', 'LD_IND'] as const) {
      const l = C[id];
      l.actual = l.ramp > 0 && dt > 0 ? approach(l.actual, l.mw, l.ramp * dt) : l.ramp > 0 ? l.actual : l.mw;
      if (l.actual === l.mw) l.ramp = 0;
    }
  }

  private drawIreland(f: FlowResult): number {
    return f.results.gridFlow + f.mw.TIE_N + f.mw.TIE_S;
  }

  private drawNI(f: FlowResult): number {
    return -f.mw.TIE_NI;
  }

  /** Re-solve the network and the derived indicators without advancing time. */
  refresh(): FlowResult {
    const s = this.s;
    if (s.preset === 'parity') {
      const f = computeFlows(s.C, s.sys, 'parity');
      applyFlows(s.C, f);
      s.results = f.results;
      this.lastFlows = f;
      return f;
    }
    const f = computeFlows(s.C, s.sys, 'engineering');
    applyFlows(s.C, f);
    s.results = f.results;
    s.contingency = contingency(s);
    s.condition = stationCondition(s);
    this.lastFlows = f;
    return f;
  }

  private engineeringStep(dt: number): void {
    const s = this.s;
    s.t += dt;
    s.steps++;
    this.fireScheduled(0);
    const line = programmeStep(s, dt);
    if (line) s.log.push({ t: s.t, kind: 'switching', id: null, text: line });
    if (s.programme && s.programme.status !== 'running') s.programme = s.programme.status === 'done' ? null : s.programme;

    this.updatePlant(dt);
    let f = computeFlows(s.C, s.sys, 'engineering');
    applyFlows(s.C, f);

    const ambient = ambientAt(s.t % 86400);
    for (const id of TRANSFORMERS) this.thermalStep(id, ambient, dt);
    if (protectTransformers(s, dt)) {
      f = computeFlows(s.C, s.sys, 'engineering');
      applyFlows(s.C, f);
    }
    s.results = f.results;
    if (f.battery.on) batteryEnergyStep(s.C.BESS, f.battery.power, dt);

    const recentEntry = [...s.log].reverse().find((l) => l.t > s.t - dt - 1e-9 && l.kind !== 'alarm');
    const recent = recentEntry ? recentEntry.text : 'Change in the station\'s net draw';
    frequencyStep(s.frequency, this.drawIreland(f), this.drawNI(f), s.sys.coupled, s.t, dt, recent);

    s.contingency = contingency(s);
    s.condition = stationCondition(s);
    if (s.fastForwardTo !== null && s.t >= s.fastForwardTo) s.fastForwardTo = null;
    if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
    this.lastFlows = f;
  }

  private fireScheduled(eps: number): void {
    const s = this.s;
    const due = s.schedule.filter((e) => e.at <= s.t + eps);
    if (!due.length) return;
    s.schedule = s.schedule.filter((e) => e.at > s.t + eps);
    for (const e of due) {
      switch (e.kind) {
        case 'trip': {
          const storming = s.preset === 'parity' ? s.sys.storm > 0 : s.weather.storm;
          if (e.ifStorm && !storming) break;
          if (s.preset === 'parity') { s.C[e.id].tripped = true; s.C[e.id].closed = false; } else trip(s, e.id, e.cause);
          break;
        }
        case 'windRamp': {
          const w = s.C.WIND;
          w.windTarget = e.to;
          w.windRamp = Math.abs(e.to - w.windSpeed) / (e.minutes * 60);
          break;
        }
        case 'weather':
          s.weather = { storm: e.storm, cloud: e.cloud, rain: e.rain };
          break;
        case 'stormEnd': {
          s.weather = { storm: false, cloud: 0.5, rain: 0 };
          const w = s.C.WIND;
          w.windTarget = 14;
          w.windRamp = Math.abs(14 - w.windSpeed) / (60 * 60);
          s.log.push({ t: s.t, kind: 'info', id: null, text: 'The storm front is clearing.' });
          break;
        }
      }
    }
  }

  // -------------------------------------------------------------------------------------
  // Time
  // -------------------------------------------------------------------------------------

  /** One step. Engineering steps should be CLOCK.stepS; parity steps are prototype frame seconds. */
  step(dt: number = this.s.preset === 'parity' ? 0.05 : CLOCK.stepS.value): void {
    if (this.s.preset === 'parity') this.parityFrame(dt);
    else this.engineeringStep(dt);
  }

  /** Advance by a whole number of fixed steps covering `seconds` of simulated time. */
  advance(seconds: number): void {
    const dt = this.s.preset === 'parity' ? 0.05 : CLOCK.stepS.value;
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) this.step(dt);
  }

  /** Run until simulated time `t` (engineering) on fixed steps. */
  runUntil(t: number): void {
    const dt = CLOCK.stepS.value;
    while (this.s.t + dt / 2 < t) this.step(dt);
  }

  // -------------------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------------------

  private metrics(f: FlowResult | null): Record<string, number> {
    const s = this.s;
    const r = f ? f.results : s.results;
    const pu = f ? f.loadPU : { T1: s.C.T1.loadPU, T2: s.C.T2.loadPU, T3: s.C.T3.loadPU, T4: s.C.T4.loadPU };
    return {
      supply: r.supply, demand: r.demand, grid: r.gridFlow, t1: pu.T1 * 100, t2: pu.T2 * 100, t3: pu.T3 * 100,
      renew: r.renewPct, freq: s.preset === 'parity' ? s.sys.freq : s.frequency.ireland, t1t: s.C.T1.temp,
    };
  }

  /** Flows once every ramp has finished: what an action leads to. */
  private settledFlows(): FlowResult {
    const s = this.s;
    if (s.preset === 'parity') return computeFlows(s.C, s.sys, 'parity');
    const C = structuredClone(s.C);
    for (const id of ['LD_TOWN', 'LD_NEW', 'LD_IND'] as const) C[id].actual = C[id].mw;
    for (const id of ['TIE_N', 'TIE_S'] as const) C[id].actual = inService(C[id]) ? clamp(C[id].set, -C[id].cap, C[id].cap) : 0;
    C.TIE_NI.actual = inService(C.TIE_NI) && s.sys.coupled ? clamp(C.TIE_NI.mw, 0, C.TIE_NI.cap) : 0;
    // Weather trajectories longer than half an hour are forecasts, not the effect of an action.
    const w = C.WIND;
    const rampSeconds = w.windRamp > 0 ? Math.abs(w.windTarget - w.windSpeed) / w.windRamp : 0;
    if (rampSeconds <= SETTLE_HORIZON_S) w.actual = Math.min(w.out, w.cap * windFraction(w.windTarget, w.cutOut).fraction);
    const g = C.GAS;
    g.actual = g.out > 0 && inService(g) ? clamp(Math.max(g.out, PLANT.gasMinStable.value * g.cap), 0, g.avail) : 0;
    return computeFlows(C, s.sys, 'engineering');
  }

  private deltas(before: Record<string, number>, after: Record<string, number>): Delta[] {
    const spec: [string, string, string, number, number][] = this.s.preset === 'parity'
      ? [['supply', 'Supply', 'MW', 0, 1], ['demand', 'Demand', 'MW', 0, 1], ['grid', 'Grid', 'MW', 0, 1], ['t1', 'T1', '%', 0, 1], ['renew', 'Renewables', '%', 0, 1], ['freq', 'Frequency', 'Hz', 2, 0.02]]
      : [['supply', 'Supply', 'MW', 0, 1], ['demand', 'Demand', 'MW', 0, 1], ['grid', '400 kV import', 'MW', 0, 1], ['t1', 'T1', '%', 0, 1], ['t2', 'T2', '%', 0, 1], ['t3', 'T3', '%', 0, 1], ['renew', 'Renewables', '%', 0, 1]];
    return spec
      .filter(([k, , , , min]) => Math.abs((after[k] ?? 0) - (before[k] ?? 0)) >= min)
      .map(([k, label, unit, digits]) => ({ key: k, label, unit, digits, before: before[k] ?? 0, after: after[k] ?? 0 }));
  }

  command(cmd: Command): CommandResult {
    const s = this.s;
    const before = this.metrics(this.lastFlows ?? this.refresh());
    let out: { ok: boolean; reason: string | null; title: string; detail: string };
    if (cmd.type === 'scenario' && cmd.id === 'reset' && s.preset === 'engineering') {
      this.inputLog.length = 0;
      this.s = Engine.initialState(s.preset, s.seed);
      this.lastFlows = null;
      out = { ok: true, reason: null, ...runEngineeringScenario(this.s, 'reset') };
    } else {
      this.inputLog.push({ t: s.t, cmd: structuredClone(cmd) });
      out = s.preset === 'parity' ? this.parityCommand(cmd) : this.engineeringCommand(cmd);
    }
    if (this.s.preset === 'parity') this.paritySolve(0.4);
    else { this.updatePlant(0); this.refresh(); }
    const immediate = this.metrics(this.lastFlows);
    const settledF = this.settledFlows();
    const settled = this.metrics(settledF);
    const settling = Object.keys(settled).some((k) => k !== 'freq' && k !== 't1t' && Math.abs((settled[k] ?? 0) - (immediate[k] ?? 0)) > 0.5);
    return { ...out, deltas: this.deltas(before, settling ? settled : immediate), settling };
  }

  private parityCommand(cmd: Command): { ok: boolean; reason: string | null; title: string; detail: string } {
    const { C, sys } = this.s;
    const ok = (title: string) => ({ ok: true, reason: null, title, detail: '' });
    switch (cmd.type) {
      case 'scenario': runParityScenario(this.s, cmd.id); return ok(scenarioMeta(cmd.id).title);
      case 'toggle': {
        const c = C[cmd.id];
        const willClose = !c.closed;
        if (willClose && c.tripped) { c.tripped = false; if (c.kind === 'tx') c.ot = 0; }
        c.closed = willClose;
        return ok(`${willClose ? 'Closed' : 'Opened'} ${c.name}`);
      }
      case 'set': (C[cmd.id] as unknown as Record<string, unknown>)[cmd.field] = cmd.value; return ok('Set');
      case 'setSys': sys[cmd.field] = cmd.value; return ok('Set');
      case 'forceCooling': C[cmd.id].cool = cmd.on; return ok('Cooling');
      case 'rebalance': this.parityAutoBalance(); return ok('Auto-balanced the station');
      case 'clearBusFault': sys.busFault = []; return ok('Fault cleared');
      case 'couple': sys.coupled = cmd.coupled; sys.shock = cmd.coupled ? 0.05 : 0.22; return ok('Coupling');
      case 'build': {
        const c = C[cmd.id];
        c.installed = true; c.closed = true;
        if (c.kind === 'gen') { c.avail = c.cap * 0.9; c.out = c.cap * 0.9; }
        if (c.kind === 'bess') c.set = 0;
        if (c.kind === 'load' && !c.mw) c.mw = 120;
        return ok(`Connected ${c.name}`);
      }
      default: return { ok: false, reason: 'Not available in the parity preset.', title: 'Not available', detail: '' };
    }
  }

  /** The prototype's autoBalance(), unchanged. */
  private parityAutoBalance(): void {
    const { C, sys } = this.s;
    const demand = (C.LD_TOWN.live ? C.LD_TOWN.mw - sys.shedMW : 0) + (C.LD_NEW.installed ? C.LD_NEW.mw : 0)
      + C.LD_IND.mw + (sys.coupled ? C.TIE_NI.mw : 0);
    C.WIND.out = C.WIND.avail;
    if (C.SOLAR.installed) C.SOLAR.out = C.SOLAR.avail;
    let rem = demand - (C.WIND.out + (C.SOLAR.installed ? C.SOLAR.out : 0));
    if (C.BESS.installed) {
      C.BESS.set = clamp(rem, -C.BESS.cap, C.BESS.cap);
      if (C.BESS.soc < 8 && C.BESS.set > 0) C.BESS.set = 0;
      if (C.BESS.soc > 95 && C.BESS.set < 0) C.BESS.set = 0;
      rem -= C.BESS.set;
    }
    if (C.GAS.installed) { C.GAS.out = clamp(rem, 0, C.GAS.avail); rem -= C.GAS.out; }
  }

  /**
   * "Rebalance local dispatch": the prototype's merit order (renewables, battery, gas, then the
   * 400 kV system), respecting battery limits and the gas unit's minimum stable generation.
   */
  private rebalance(): void {
    const { C, sys } = this.s;
    const demand = (C.LD_TOWN.live ? Math.max(0, C.LD_TOWN.mw - sys.shedMW) : 0) + (C.LD_NEW.installed && C.LD_NEW.closed ? C.LD_NEW.mw : 0)
      + (C.LD_IND.live ? C.LD_IND.mw : 0) + (sys.coupled && inService(C.TIE_NI) ? C.TIE_NI.mw : 0)
      - (inService(C.TIE_N) ? C.TIE_N.set : 0) - (inService(C.TIE_S) ? C.TIE_S.set : 0);
    C.WIND.out = C.WIND.cap;
    if (C.SOLAR.installed) C.SOLAR.out = C.SOLAR.cap;
    let rem = demand - (C.WIND.avail + (C.SOLAR.installed ? C.SOLAR.avail : 0));
    if (C.BESS.installed && inService(C.BESS)) {
      let set = clamp(rem, -C.BESS.cap, C.BESS.cap);
      if (set > 0 && C.BESS.soc <= PLANT.batterySocMin.value + 3) set = 0;
      if (set < 0 && C.BESS.soc >= PLANT.batterySocMax.value) set = 0;
      C.BESS.set = set;
      rem -= set;
    }
    if (C.GAS.installed && inService(C.GAS)) {
      const msg = PLANT.gasMinStable.value * C.GAS.cap;
      const want = clamp(rem, 0, C.GAS.avail);
      C.GAS.out = want >= msg ? want : 0;
    }
  }

  private engineeringCommand(cmd: Command): { ok: boolean; reason: string | null; title: string; detail: string } {
    const s = this.s;
    const { C, sys } = s;
    const ok = (title: string, detail = '') => ({ ok: true, reason: null, title, detail });
    const no = (reason: string) => ({ ok: false, reason, title: 'Not possible', detail: reason });
    switch (cmd.type) {
      case 'scenario': {
        s.log.push({ t: s.t, kind: 'scenario', id: null, text: `Scenario: ${scenarioMeta(cmd.id).title}.` });
        const o = runEngineeringScenario(s, cmd.id);
        return { ok: true, reason: null, ...o };
      }
      case 'operate': {
        const r = operate(s, cmd.id, cmd.device, cmd.action);
        if (!r.ok) return no(r.reason ?? 'Interlocked.');
        s.log.push({ t: s.t, kind: 'switching', id: cmd.id, text: `${cmd.action === 'open' ? 'Opened' : 'Closed'} ${C[cmd.id].name} ${cmd.device === 'cb' ? 'circuit breaker' : cmd.device === 'es' ? 'earth switch' : 'disconnector'}.` });
        return ok(`${cmd.action === 'open' ? 'Opened' : 'Closed'} ${C[cmd.id].name}`);
      }
      case 'programme': {
        if (s.programme && s.programme.status === 'running') return no('Another switching programme is in progress.');
        const steps = cmd.programme === 'outOfService' ? outOfServiceSteps(s, cmd.id) : returnToServiceSteps(s, cmd.id);
        if (!steps.length) return no('Nothing to switch.');
        const title = `${cmd.programme === 'outOfService' ? 'Take out of service' : 'Return to service'}: ${C[cmd.id].name}`;
        s.programme = startProgramme(title, steps);
        return ok(title, `${steps.length} switching steps, each confirmed and interlocked.`);
      }
      case 'resetProtection': {
        const c = C[cmd.id];
        if (!c.tripped) return no(`${c.name} protection is not locked out.`);
        if (!cmd.confirmed) return no('A person must confirm the cause has been inspected and cleared.');
        if (c.section && sys.busFault.includes(c.section)) return no(`Clear the fault on section ${c.section} first.`);
        c.tripped = false; c.tripCause = null;
        if (c.kind === 'tx') { c.ocTimer = 0; }
        s.log.push({ t: s.t, kind: 'protection', id: c.id, text: `${c.name} protection reset after inspection.` });
        return ok(`${c.name} protection reset`, 'The breaker stays open until it is closed by a switching action or programme.');
      }
      case 'clearBusFault': {
        if (!sys.busFault.includes(cmd.section)) return no(`Section ${cmd.section} is not faulted.`);
        if (!cmd.confirmed) return no('A person must confirm the fault is clear before re-energisation.');
        sys.busFault = sys.busFault.filter((x) => x !== cmd.section);
        const steps = [];
        for (const id of SECTION_B_BREAKERS) {
          const c = C[id];
          if (c.tripped && c.tripCause?.startsWith('bus-zone')) { c.tripped = false; c.tripCause = null; steps.push({ id, device: 'cb' as const, action: 'close' as const }); }
        }
        if (steps.length) s.programme = startProgramme(`Re-energise 220 kV section ${cmd.section}`, steps);
        s.log.push({ t: s.t, kind: 'protection', id: null, text: `Fault on section ${cmd.section} confirmed clear by the operator.` });
        return ok(`Section ${cmd.section} cleared`, 'Re-energisation runs as a switching programme, one breaker at a time.');
      }
      case 'forceCooling':
        C[cmd.id].cool = cmd.on;
        return ok(`${cmd.on ? 'Forced all cooling on' : 'Returned to automatic cooling'}: ${cmd.id}`);
      case 'setGeneration': {
        const g = C[cmd.id];
        if (!g.installed) return no(`${g.name} is not built.`);
        g.out = clamp(cmd.out, 0, g.cap);
        return ok(`${g.name} set to ${g.out.toFixed(0)} MW`);
      }
      case 'setBattery':
        if (!C.BESS.installed) return no('The battery is not built.');
        C.BESS.set = clamp(cmd.mw, -C.BESS.cap, C.BESS.cap);
        return ok(C.BESS.set >= 0 ? `Battery discharging ${C.BESS.set.toFixed(0)} MW` : `Battery charging ${(-C.BESS.set).toFixed(0)} MW`);
      case 'requestTransfer': {
        const t = C[cmd.id];
        t.set = clamp(cmd.mw, -t.cap, t.cap);
        return ok(`Transfer of ${Math.abs(t.set).toFixed(0)} MW requested ${t.set >= 0 ? 'from' : 'to'} ${t.name}`);
      }
      case 'setBorderTransfer':
        C.TIE_NI.mw = clamp(cmd.mw, 0, C.TIE_NI.cap);
        return ok(`Northbound transfer scheduled at ${C.TIE_NI.mw.toFixed(0)} MW`);
      case 'setDemand': {
        const l = C[cmd.id];
        l.mw = Math.max(0, cmd.mw);
        l.ramp = cmd.rampMinutes ? Math.abs(l.mw - l.actual) / (cmd.rampMinutes * 60) : 0;
        return ok(`${l.name} set to ${l.mw.toFixed(0)} MW`);
      }
      case 'setWind': {
        const w = C.WIND;
        w.windTarget = Math.max(0, cmd.speed);
        w.windRamp = cmd.rampMinutes ? Math.abs(w.windTarget - w.windSpeed) / (cmd.rampMinutes * 60) : 0;
        return ok(`Wind set to ${w.windTarget.toFixed(1)} m/s`);
      }
      case 'shed':
        sys.shedMW = clamp(cmd.mw, 0, C.LD_TOWN.mw);
        return ok(sys.shedMW > 0 ? `Shed ${sys.shedMW.toFixed(0)} MW of regional demand` : 'Shed demand restored');
      case 'build': {
        build(s, cmd.id);
        return ok(`Connected ${C[cmd.id].name}`);
      }
      case 'rebalance':
        this.rebalance();
        return ok('Rebalanced local dispatch', 'Renewables first, then the battery, then gas, so the least is drawn from the 400 kV system.');
      case 'couple':
        if (cmd.coupled) { sys.coupled = true; C.TIE_NI.closed = true; } else { sys.coupled = false; C.TIE_NI.closed = false; }
        return ok(cmd.coupled ? 'Border tie reconnected' : 'Border tie opened');
      case 'fastForward':
        if (cmd.to <= s.t) return no('That time has already passed.');
        s.fastForwardTo = cmd.to;
        return ok('Running forward');
      default:
        return no('Not available in the engineering preset.');
    }
  }

  // -------------------------------------------------------------------------------------
  // Snapshots and replay
  // -------------------------------------------------------------------------------------

  snapshot(): SimState {
    return structuredClone(this.s);
  }

  stateHash(): string {
    return hash(this.s);
  }

  /** Rebuild a state from scratch by replaying an input log on fixed steps. */
  static replay(preset: Preset, seed: number, log: readonly LoggedCommand[], until: number): Engine {
    const e = new Engine({ preset, seed });
    for (const entry of log) {
      if (preset === 'engineering') e.runUntil(entry.t);
      e.command(entry.cmd);
    }
    if (preset === 'engineering') e.runUntil(until);
    return e;
  }
}
