/**
 * The twin: the engine, its agents and the coordinator, stepped together. Deterministic: the
 * agents only observe, and anything that changes the plant goes through engine commands, so the
 * input log replays the whole session.
 */
import { LIMITS, RATINGS } from '../config/assumptions.ts';
import { Engine, type Command, type CommandResult, type EngineOptions } from '../sim/engine.ts';
import { scenarioMeta } from '../sim/scenarios.ts';
import { AgentSystem, ruleCount, ruleSetHash } from './agents.ts';
import { Coordinator } from './coordinator.ts';
import type { AgentView, RuleSetMode } from './types.ts';

export type Decision =
  | { type: 'approve'; recId: string; optionId: string; operator: string }
  | { type: 'reject'; recId: string; operator: string }
  | { type: 'modify'; recId: string; optionId: string; value: number; operator: string }
  | { type: 'confirmClear'; section: 'A' | 'B'; operator: string }
  | { type: 'ruleset'; mode: RuleSetMode }
  | { type: 'rewind'; t: number };

export class Twin {
  engine: Engine;
  readonly agents = new AgentSystem();
  readonly coord = new Coordinator();
  /** Wall-clock source for audit entries (injected so tests stay deterministic). */
  wall: () => string = () => new Date().toISOString();
  fast = false;

  private opts: EngineOptions;

  constructor(opts: EngineOptions = {}) {
    this.opts = opts;
    this.engine = new Engine(opts);
    this.agents.observe(this.engine.s, 0);
    this.coord.tick(this.engine, this.agents, { fast: false });
  }

  get s() { return this.engine.s; }

  step(dt?: number): void {
    const before = this.engine.s.t;
    this.engine.step(dt);
    this.agents.observe(this.engine.s, this.engine.s.t - before);
    this.coord.tick(this.engine, this.agents, { fast: this.fast });
  }

  advance(seconds: number): void {
    const n = Math.round(seconds / 5);
    for (let i = 0; i < n; i++) this.step();
  }

  runUntil(t: number): void {
    while (this.engine.s.t + 2.5 < t) this.step();
  }

  command(cmd: Command): CommandResult {
    const s = this.engine.s;
    const before = { headroom: this.headroom(), renew: s.results.renewPct, worst: s.contingency.worst };
    const r = this.engine.command(cmd);
    if (cmd.type === 'scenario' && cmd.id === 'reset') { this.agents.reset(); this.coord.reset(); }
    this.agents.observe(this.engine.s, 0);
    if (cmd.type === 'scenario' && r.ok) {
      const meta = scenarioMeta(cmd.id);
      if (meta.group === 'Growth and new connections' || meta.group === 'Generation mix') {
        const after = { headroom: this.headroom(), renew: this.engine.s.results.renewPct, worst: this.engine.s.contingency.worst };
        this.agents.pushTrace({
          t: this.engine.s.t, agent: 'COORD', ruleId: 'ADVISORY', version: '1.0', outcome: 'screen', severity: 'advisory',
          text: `${meta.title}: N-1 headroom ${Math.round(before.headroom)} MW to ${Math.round(after.headroom)} MW; renewable share ${Math.round(before.renew)}% to ${Math.round(after.renew)}%.`,
          inputs: { headroomBefore: Math.round(before.headroom), headroomAfter: Math.round(after.headroom), n1LoadingAfter: Math.round(after.worst * 100) / 100 }, threshold: { value: LIMITS.n1SecureLoading.value, unit: 'per unit', source: LIMITS.n1SecureLoading.source, label: LIMITS.n1SecureLoading.label },
          methods: ['METHOD-SCREEN-01'], narration: `Advisory only. ${after.headroom < 0 ? 'After this change the station is no longer N-1 secure.' : 'The station stays N-1 secure.'}`,
        });
      }
    }
    return r;
  }

  private headroom(): number {
    const w = this.engine.s.contingency.worst;
    return w > 0 ? (LIMITS.n1SecureLoading.value - w) * RATINGS.T1.value : 0;
  }

  decide(d: Decision): { ok: boolean; reason?: string } {
    const mode = this.agents.mode;
    const h = ruleSetHash(mode);
    const hashOf = () => this.engine.stateHash();
    switch (d.type) {
      case 'approve': return this.coord.approve(this.engine, this.agents, d.recId, d.optionId, d.operator, this.wall(), hashOf, mode, h);
      case 'reject': return this.coord.reject(this.engine, this.agents, d.recId, d.operator, this.wall(), hashOf, mode, h);
      case 'modify': return this.coord.modify(this.engine, this.agents, d.recId, d.optionId, d.value, d.operator, this.wall(), hashOf, mode, h);
      case 'confirmClear': return this.coord.confirmClear(this.engine, this.agents, d.section, d.operator, this.wall(), hashOf, mode, h);
      case 'ruleset': this.agents.mode = d.mode; return { ok: true };
      case 'rewind': return this.rewind(d.t);
    }
  }

  /** Go back in time by replaying the input log from the start (deterministic, so the past is exact). */
  rewind(t: number): { ok: boolean; reason?: string } {
    if (t >= this.engine.s.t) return { ok: false, reason: 'Use fast-forward to go forward.' };
    const log = this.engine.inputLog.filter((e) => e.t <= t).map((e) => ({ t: e.t, cmd: structuredClone(e.cmd) }));
    const mode = this.agents.mode;
    this.engine = new Engine(this.opts);
    this.agents.reset();
    this.coord.reset();
    this.agents.mode = mode;
    this.agents.observe(this.engine.s, 0);
    for (const e of log) {
      this.runUntil(e.t);
      // Fast-forwards replay as plain runs, so the clock is not left time-lapsing.
      if (e.cmd.type !== 'fastForward') this.command(e.cmd);
    }
    this.runUntil(t);
    return { ok: true };
  }

  view(): AgentView {
    const a = this.agents;
    const c = this.coord.state;
    const fault = this.engine.s.sys.busFault[0];
    return {
      mode: a.mode, ruleSetHash: ruleSetHash(a.mode), ruleCount: ruleCount(a.mode),
      feed: a.feed.slice(-150), statuses: [...a.statuses.values()], arcs: a.arcs.slice(-12),
      // Only the newest recommendations travel with each snapshot, and only pending ones keep their sample series.
      recommendations: c.recommendations.slice(-3).map((r) => (r.status === 'pending' ? r : { ...r, baseline: { ...r.baseline, samples: [] }, options: r.options.map((o) => ({ ...o, outcome: { ...o.outcome, samples: [] } })) })),
      tracking: c.tracking ? { ...c.tracking, predicted: [] } : null, audit: c.audit, screen: c.screen, earlyCatch: c.earlyCatch,
      previews: {}, blocked: fault ? { section: fault, reason: `220 kV section ${fault}: re-energisation blocked until a person confirms the fault is clear.` } : null,
    };
  }

  /** Predicted end states for the newest plan (sent separately, only when it changes). */
  previews(): { forRec: string | null; states: Record<string, unknown> } {
    return { forRec: this.coord.state.previewFor, states: this.coord.state.previews };
  }
}
