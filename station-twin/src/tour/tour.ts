/**
 * The guided demo: eight beats over one simulated day. Every beat is reached deterministically
 * by replaying the beats before it, so Left and Right always land on the same state. At a
 * decision point the tour pauses on the coordinator's recommendation; Right approves the
 * top-ranked option (logged as the presenter's) after the screen has said what it will do.
 */
import type { Twin } from '../agents/twin.ts';
import type { Lens } from '../scene/stage.ts';
import type { ComponentId } from '../sim/types.ts';

const DAY = 86400;
const at = (h: number, m = 0) => DAY + h * 3600 + m * 60;

export interface TourEvent { at: number; run: (tw: Twin) => void }
export interface CameraShot { target: [number, number, number]; from: [number, number, number]; seconds?: number }

export interface Beat {
  id: string;
  title: string;
  caption: string;
  start: number;
  end: number;
  /** Simulated seconds per wall second while the beat runs (0: paused). */
  compression: number;
  lens: Lens;
  select: ComponentId | null;
  feed: boolean;
  decision: boolean;
  /** Camera path for the beat: shots flown in order. */
  shots: CameraShot[];
  /** Events applied when simulated time reaches them (those at the start apply on entry). */
  events: TourEvent[];
}

const YARD: CameraShot = { target: [-55, 4, 0], from: [170, 150, 330], seconds: 4 };

export const BEATS: readonly Beat[] = [
  {
    id: 'arrival', title: 'Arrival', start: at(7, 40), end: at(7, 40), compression: 0, lens: 'physical', select: null, feed: false, decision: false,
    caption: 'Clonmore, a fictional 400/275/220/110 kV station in drumlin country near the border. Dawn, Wednesday 11 March. Every number on screen comes from the simulation.',
    shots: [{ target: [900, 60, -1300], from: [2200, 420, -2600], seconds: 0 }, { target: [-400, 20, -150], from: [600, 380, -1400], seconds: 9 }, YARD],
    events: [],
  },
  {
    id: 'day', title: 'A working day', start: at(7, 40), end: at(13, 0), compression: 320, lens: 'flow', select: null, feed: false, decision: false,
    caption: 'Time-lapse to 13:00. The solar farm, battery and gas peaker are commissioned and the wind freshens. At midday the peaker runs its commissioning test, Ardnagreany sends its surplus wind through and regional demand eases: the 400 kV conductors reverse as Clonmore exports.',
    shots: [{ target: [-150, 6, -30], from: [-420, 160, -260], seconds: 4 }],
    events: [
      { at: at(7, 40), run: (tw) => { for (const id of ['add_solar', 'add_bess', 'add_gas', 'wind_up'] as const) tw.command({ type: 'scenario', id }); } },
      { at: at(10, 30), run: (tw) => tw.command({ type: 'setDemand', id: 'LD_TOWN', mw: 400, rampMinutes: 90 }) },
      { at: at(11, 0), run: (tw) => { tw.command({ type: 'setGeneration', id: 'GAS', out: 180 }); tw.command({ type: 'setBattery', mw: 100 }); tw.command({ type: 'requestTransfer', id: 'TIE_N', mw: 150 }); } },
    ],
  },
  {
    id: 'circuit', title: 'The circuit', start: at(13, 0), end: at(13, 0), compression: 0, lens: 'circuit', select: 'T2', feed: false, decision: false,
    caption: 'The clock is paused. The physical yard folds into its single-line diagram: the three phases of every bay converge into one line. T2 stays selected throughout, with the same live values.',
    shots: [], events: [],
  },
  {
    id: 'agents', title: 'Meet the agents', start: at(13, 0), end: at(13, 0), compression: 0, lens: 'physical', select: 'T2', feed: true, decision: false,
    caption: 'Every asset has an agent with frozen, sourced rules. Each transformer also runs its own thermal model, so it can tell when it is hotter than it should be. They report; the coordinator plans; people decide.',
    shots: [{ target: [-87, 4, 28], from: [-40, 30, 75], seconds: 3 }],
    events: [{ at: at(13, 0), run: (tw) => { tw.command({ type: 'setGeneration', id: 'GAS', out: 0 }); tw.command({ type: 'setBattery', mw: 0 }); tw.command({ type: 'setDemand', id: 'LD_TOWN', mw: 480, rampMinutes: 60 }); tw.command({ type: 'requestTransfer', id: 'TIE_N', mw: 0 }); } }],
  },
  {
    id: 'peak', title: 'Evening peak', start: at(13, 0), end: at(17, 30), compression: 300, lens: 'physical', select: null, feed: true, decision: true,
    caption: 'Towards sunset, regional demand ramps by 180 MW and the town lights come on. The coordinator screens every contingency before anything has failed, and recommends acting now.',
    shots: [{ target: [-55, 4, 0], from: [260, 120, 300], seconds: 4 }],
    events: [{ at: at(16, 30), run: (tw) => tw.command({ type: 'scenario', id: 'peak' }) }],
  },
  {
    id: 'n1', title: 'Loss of T1', start: at(17, 30), end: at(19, 30), compression: 120, lens: 'flow', select: 'T2', feed: true, decision: true,
    caption: 'T1 trips. T2 carries the station and its agent projects its time to limit. The coordinator ranks the options; hover one to see its predicted flows and heat. Approve, and the station follows the prediction.',
    shots: [{ target: [-87, 4, 20], from: [-10, 60, 110], seconds: 3 }],
    events: [{ at: at(17, 30), run: (tw) => tw.command({ type: 'scenario', id: 'n1' }) }],
  },
  {
    id: 'storm', title: 'Storm', start: at(19, 30), end: at(21, 30), compression: 120, lens: 'physical', select: null, feed: true, decision: true,
    caption: 'T1 returns to service through an interlocked switching programme. A front arrives; the wind agent flags cut-out from the forecast. A lightning flashover at T2 and differential protection trips it. The coordinator rebalances.',
    shots: [{ target: [-55, 10, 0], from: [380, 200, 420], seconds: 4 }],
    events: [
      { at: at(19, 30), run: (tw) => { tw.command({ type: 'resetProtection', id: 'T1', confirmed: true }); tw.command({ type: 'programme', id: 'T1', programme: 'returnToService' }); } },
      { at: at(19, 45), run: (tw) => tw.command({ type: 'scenario', id: 'storm' }) },
    ],
  },
  {
    id: 'recovery', title: 'Recovery', start: at(21, 30), end: at(23, 0), compression: 120, lens: 'physical', select: null, feed: false, decision: false,
    caption: 'The storm clears and T2 is restored. Agents recommend. People decide. Every decision is traceable.',
    shots: [{ target: [-55, 4, 1200], from: [900, 500, -900], seconds: 6 }],
    events: [
      { at: at(21, 30), run: (tw) => { tw.command({ type: 'scenario', id: 'wind_dn' }); if (tw.s.C.T2.tripped) tw.command({ type: 'resetProtection', id: 'T2', confirmed: true }); } },
      { at: at(21, 50), run: (tw) => tw.command({ type: 'programme', id: 'T2', programme: 'returnToService' }) },
    ],
  },
];

export interface TourStatus {
  beat: number;
  count: number;
  id: string;
  title: string;
  caption: string;
  awaiting: 'approve' | 'next' | null;
  /** What Right will do next, said before it happens. */
  nextAction: string;
  summary: { alerts: number; recommendations: number; approved: number } | null;
}

export const PRESENTER = 'Presenter';

/** Drives a twin through the beats. Pure with respect to wall time: give it the same presses and it gives the same day. */
export class TourRunner {
  beat = 0;
  awaiting: 'approve' | 'next' | null = null;
  private applied = new Set<string>();
  private seenRecs = new Set<string>();

  /** Build a twin at the start of beat k by replaying every beat before it (approving the top option at each decision). */
  static at(k: number, makeTwin: () => Twin, wall: () => string): { twin: Twin; runner: TourRunner } {
    const twin = makeTwin();
    twin.wall = wall;
    const runner = new TourRunner();
    runner.enter(twin, 0);
    for (let i = 0; i < k; i++) { runner.finish(twin); runner.enter(twin, i + 1); }
    return { twin, runner };
  }

  enter(tw: Twin, k: number): void {
    this.beat = Math.max(0, Math.min(BEATS.length - 1, k));
    const b = BEATS[this.beat]!;
    if (tw.s.t < b.start) { tw.command({ type: 'fastForward', to: b.start }); tw.runUntil(b.start); }
    this.awaiting = b.compression === 0 ? 'next' : null;
    this.after(tw);
  }

  /** Call after every simulation step while the tour runs. Returns true when the clock should pause. */
  after(tw: Twin): boolean {
    const b = BEATS[this.beat]!;
    b.events.forEach((ev, i) => {
      const key = `${b.id}:${i}`;
      if (!this.applied.has(key) && tw.s.t >= ev.at - 1e-6) { this.applied.add(key); ev.run(tw); }
    });
    if (b.decision && this.awaiting === null) {
      const rec = tw.view().recommendations.find((r) => r.status === 'pending' && r.options.length > 0 && !this.seenRecs.has(r.id));
      if (rec) { this.seenRecs.add(rec.id); this.awaiting = 'approve'; return true; }
    }
    if (tw.s.t >= b.end - 1e-6 && this.awaiting === null) { this.awaiting = 'next'; return true; }
    return this.awaiting !== null;
  }

  /** Right: approve the top-ranked option at a decision point, otherwise finish the beat and enter the next. */
  next(tw: Twin): 'approved' | 'advanced' | 'end' {
    if (this.awaiting === 'approve') {
      const rec = tw.view().recommendations.find((r) => r.status === 'pending');
      if (rec && rec.options[0]) tw.decide({ type: 'approve', recId: rec.id, optionId: rec.options[0].id, operator: PRESENTER });
      this.awaiting = null;
      this.after(tw);
      return 'approved';
    }
    if (this.beat >= BEATS.length - 1) { this.finish(tw); return 'end'; }
    this.finish(tw);
    this.enter(tw, this.beat + 1);
    return 'advanced';
  }

  /** Run the rest of the beat deterministically, approving the top option at each decision. */
  finish(tw: Twin): void {
    const b = BEATS[this.beat]!;
    let guard = 0;
    while (guard++ < 200000) {
      if (this.awaiting === 'approve') { this.next(tw); continue; }
      if (tw.s.t >= b.end - 1e-6) break;
      this.awaiting = null;
      tw.step();
      this.after(tw);
      if (this.awaiting === 'next') break;
    }
    this.awaiting = 'next';
  }

  status(tw: Twin): TourStatus {
    const b = BEATS[this.beat]!;
    const rec = tw.view().recommendations.find((r) => r.status === 'pending');
    const nextAction = this.awaiting === 'approve' && rec?.options[0]
      ? `Right approves option 1: ${rec.options[0].label}.`
      : this.beat >= BEATS.length - 1 ? 'End of the tour.' : `Right continues to ${BEATS[this.beat + 1]!.title.toLowerCase()}.`;
    const v = tw.view();
    const summary = b.id === 'recovery' ? {
      alerts: tw.agents.feed.filter((e) => e.outcome === 'fired' && (e.severity === 'warning' || e.severity === 'critical')).length,
      recommendations: tw.coord.recommendationCount,
      approved: v.audit.filter((a) => a.decision === 'approve').length,
    } : null;
    return { beat: this.beat, count: BEATS.length, id: b.id, title: b.title, caption: b.caption, awaiting: this.awaiting, nextAction, summary };
  }
}
