import { lonLatToItm } from '@/lib/geo';
import { useWorld } from '@/app/store';
import { useSim } from '@/sim/client';
import { topCorridors, type Corridor } from '@/sim/corridors';
import type { ScenarioId } from '@/sim/scenarios';
import { useUi } from '@/ui/uiStore';
import type { Shot } from './camera';

/**
 * Director scripts: each scenario is a sequence of beats. A beat frames the camera, sets or runs
 * the clock, may change inputs or open a panel, and carries a caption and the narration template.
 * Every beat sets up the state it needs, so a presenter can jump to any beat. Beats that need a
 * human decision wait for it; the Director never approves anything.
 */
export interface Beat {
  id: string;
  title: string;
  caption: string | (() => string);
  /** Narration template (spoken-style text); M7 may rephrase it with an LLM when enabled. */
  narration: string | (() => string);
  shot: Shot | (() => Shot | null);
  /** Seconds of camera move into the beat. */
  fly?: number;
  hours?: number;
  /** While playing, the clock runs from `hours` to this over the hold. */
  timeTo?: number;
  /** Seconds the beat holds while playing. */
  hold: number;
  enter?: (later: (ms: number, fn: () => void) => void) => void;
  /** While playing, the Director holds on this beat until it returns true. */
  waitFor?: () => boolean;
}

export interface Script {
  id: ScenarioId;
  title: string;
  beats: Beat[];
}

const itm = (lon: number, lat: number) => lonLatToItm(lon, lat);
const nat = itm(-7.8, 53.28);
const national: Shot = { e: nat.e, n: nat.n, dist: 780_000, polar: 34, az: -10 };
const dub = itm(-6.32, 53.35);
const at = (e: number, n: number, dist: number, polar = 52, az = 200): Shot => ({ e, n, dist, polar, az });

// Station positions (ITM), from the network data.
const ST = {
  bellacorick: [496_794, 820_197],
  castlebar: [516_517, 791_536],
  glenree: [535_301, 817_817],
  cunghill: [557_550, 818_205],
  sligo: [569_550, 832_586],
  srananagh: [574_932, 825_491],
  flagford: [591_862, 795_818],
  arigna: [595_060, 816_167],
  carrick: [592_851, 798_678],
} as const;
const mid = (a: readonly [number, number], b: readonly [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;

const sim = () => useSim.getState();
const ui = () => useUi.getState();
const branchId = (label: string) => sim().meta?.branches.find((b) => b.label === label)?.id ?? null;
const select = (label: string | null) => {
  const id = label ? branchId(label) : null;
  ui().set({ selectedBranch: id, selectedAgent: id ? (sim().meta?.agents.find((a) => a.ref === id)?.id ?? null) : null });
};
/** Apply a scenario only if it is not already loaded, so decisions made in earlier beats stay. */
const ensure = (id: ScenarioId) => {
  if (sim().inputs.scenario !== id || !sim().day) {
    sim().applyScenario(id);
    ui().set({ decisions: {}, selectedBranch: null, selectedAgent: null, feedOpen: false });
  }
};
const panels = (patch: Partial<ReturnType<typeof ui>> = {}) => ui().set({ feedOpen: false, notesOpen: false, governanceOpen: false, auditOpen: false, ...patch });

/** Later hero beats need the studies; run them if the presenter jumped straight in. */
const ensureStudy = () => {
  ensure('hero');
  const { meta, study, studyRunning, runStudy } = sim();
  const bus = meta?.largeLoads.find((l) => l.id === 'nw-leu')?.bus;
  if (bus && !study && !studyRunning) runStudy(bus, 50, 150);
};

export function corridors(): Corridor[] {
  const { day, meta, inputs } = sim();
  if (!day || !meta || inputs.scenario !== 'y2034' || (inputs.year ?? 2034) < 2034) return [];
  return topCorridors(day, meta);
}

const corridorBeat = (k: number): Beat => ({
  id: `corridor-${k + 1}`,
  title: `Corridor ${k + 1}`,
  shot: () => {
    const c = corridors()[k];
    return c ? at(c.e, c.n, c.kv >= 220 ? 34_000 : 20_000, 52, 200 + k * 25) : null;
  },
  fly: 4.5,
  hours: 18,
  hold: 8,
  enter: () => {
    const c = corridors()[k];
    if (c) select(c.label);
  },
  caption: () => {
    const c = corridors()[k];
    if (!c) return 'Finding the corridors.';
    const n1 = c.hoursN1 ? `above its rating for ${c.hoursN1.toFixed(1)} hours of the day after a single fault, peaking at ${Math.round(c.peakN1 * 100)}%` : '';
    const intact = c.hoursIntact ? `${n1 ? '; ' : ''}over its rating for ${c.hoursIntact.toFixed(1)} hours with nothing out` : '';
    return `${c.rank}. ${c.label}: ${n1}${intact}.`;
  },
  narration: () => {
    const c = corridors()[k];
    return c ? `Number ${c.rank}: ${c.label}. ${c.hoursIntact ? 'Overloaded even with everything in service, at the evening peak.' : 'Secure with everything in service, but not after a single fault.'}` : '';
  },
});

export const scripts: Record<ScenarioId, Script> = {
  today: {
    id: 'today',
    title: 'The grid today',
    beats: [
      {
        id: 'dawn',
        title: 'Morning',
        shot: national,
        fly: 2,
        hours: 6,
        timeTo: 9,
        hold: 13,
        enter: () => {
          ensure('today');
          panels();
          select(null);
        },
        caption: 'Six in the morning, a Wednesday in October. Demand is rising and wind is doing much of the work.',
        narration: 'This is the all-island transmission system on an ordinary autumn day. Every line you see is a real route from open map data; every number is simulated, calibrated to public figures.',
      },
      {
        id: 'dublin',
        title: 'Dublin',
        shot: at(dub.e, dub.n, 70_000, 52, 160),
        fly: 4.5,
        hours: 9,
        timeTo: 12,
        hold: 13,
        caption: 'Dublin draws the largest share of demand. Data centres here take close to a fifth of the Republic’s electricity, day and night.',
        narration: 'Dublin is where demand concentrates. The data centre clusters to the west of the city run almost flat, around the clock.',
      },
      {
        id: 'west',
        title: 'The west',
        shot: at(540_000, 812_000, 160_000, 50, 200),
        fly: 5,
        hours: 12,
        timeTo: 15,
        hold: 13,
        caption: 'Most of the wind is in the west. The 110 kV network carries it east, and that is where it gets tight.',
        narration: 'Most of the wind is in the west and north west, a long way from the load. Moving it east is the daily work of the network.',
      },
      {
        id: 'agents',
        title: 'Agents',
        shot: at(ST.flagford[0], ST.flagford[1], 650, 58, 150),
        fly: 5,
        hours: 15,
        timeTo: 16,
        hold: 12,
        caption: 'Every circuit, transformer, station and wind farm has an agent. Each watches its own asset against fixed, published rules.',
        narration: 'Each asset has its own agent: almost a thousand of them. They do not learn on the fly. They apply versioned rules and say which rule fired, on what inputs.',
      },
      {
        id: 'feed',
        title: 'Agent feed',
        shot: at(560_000, 790_000, 260_000, 42, 190),
        fly: 4,
        hours: 16,
        timeTo: 17.5,
        hold: 12,
        enter: () => panels({ feedOpen: true }),
        caption: 'Their findings arrive here, each with its rule, inputs and threshold. Nothing is learned at run time.',
        narration: 'Every finding is traceable: the rule, its version, the values it read and the threshold it crossed.',
      },
      {
        id: 'peak',
        title: 'Evening peak',
        shot: national,
        fly: 4,
        hours: 17.5,
        timeTo: 19,
        hold: 13,
        enter: () => panels(),
        caption: 'Evening peak. The schedule keeps every circuit within rating, with everything in service and after any single fault.',
        narration: 'At the evening peak the day-ahead schedule keeps the system secure. Where it cannot, the agents say so.',
      },
      {
        id: 'night',
        title: 'Night',
        shot: { ...national, polar: 40, az: 15 },
        fly: 5,
        hours: 19,
        timeTo: 22,
        hold: 12,
        caption: 'One day in ninety seconds. Next: a request to connect 50 MW in the north west.',
        narration: 'That is one day. Now, a decision: a request to connect fifty megawatts of new demand in the north west.',
      },
    ],
  },

  hero: {
    id: 'hero',
    title: 'A 50 MW connection request in the north west',
    beats: [
      {
        id: 'request',
        title: 'The request',
        shot: at(528_000, 812_000, 115_000, 50, 195),
        fly: 4,
        hours: 14,
        hold: 11,
        enter: () => {
          ensure('hero');
          panels();
          select(null);
          ui().set({ hero: { dialMW: null, evidenceOpen: false, decision: ui().hero.decision, offeredMW: ui().hero.offeredMW } });
        },
        caption: 'A request arrives: 50 MW of new, near-flat demand in north Mayo.',
        narration: 'A request arrives to connect fifty megawatts of new demand in north Mayo. Near flat, all year.',
      },
      {
        id: 'point',
        title: 'Connection point',
        shot: at(ST.bellacorick[0], ST.bellacorick[1], 2_600, 58, 210),
        fly: 5,
        hours: 14,
        hold: 10,
        caption: 'Connection point assumed: Bellacorick 110 kV, the nearest existing station.',
        narration: 'We assume the nearest existing 110 kV station, Bellacorick. That is an assumption, and it is labelled as one.',
      },
      {
        id: 'studies',
        title: 'Studies',
        shot: at(535_000, 815_000, 75_000, 46, 200),
        fly: 4,
        hours: 14,
        hold: 12,
        enter: () => {
          ensureStudy();
        },
        waitFor: () => !!sim().study,
        caption: 'Four studies, every 15 minutes: a typical day, winter peak, a low-wind week, and the main feed out. Each intact and after any single fault.',
        narration: 'The twin runs four studies, each in fifteen-minute steps, with everything in service and after the loss of any single circuit.',
      },
      {
        id: 'firm',
        title: 'Firm',
        shot: () => {
          const [e, n] = mid(ST.bellacorick, ST.castlebar);
          return at(e, n, 32_000, 52, 230);
        },
        fly: 4,
        hours: 14,
        hold: 13,
        enter: () => {
          ensureStudy();
          select('Bellacorick to Castlebar 110 kV');
        },
        caption: () => {
          const s = sim().study;
          return s && s.firmAllMW >= 50
            ? 'Fifty megawatts is firm in every studied interval. The agents add what studies cannot see: this circuit’s vegetation survey is 41 months old.'
            : `Firm up to ${Math.floor(s?.firmAllMW ?? 0)} MW. The agents add what studies cannot see: this circuit’s vegetation survey is 41 months old.`;
        },
        narration: 'The studies say the request fits. The agents know something the studies do not: the vegetation survey on this circuit is forty-one months old.',
      },
      {
        id: 'joint',
        title: 'Conditions',
        shot: () => {
          const [e, n] = mid(ST.glenree, ST.cunghill);
          return at(e, n, 16_000, 55, 200);
        },
        fly: 4,
        hours: 14,
        hold: 11,
        enter: () => {
          ensureStudy();
          select('Glenree to Cunghill 110 kV');
        },
        caption: 'A joint on Glenree to Cunghill ran 26 °C hot at its last survey. Findings like these become conditions precedent: resolve before energisation.',
        narration: 'And a joint on Glenree to Cunghill ran twenty-six degrees hot at its last thermal survey. These findings become conditions on the offer.',
      },
      {
        id: 'dial',
        title: 'Firmness dial',
        shot: () => {
          const [e, n] = mid(ST.cunghill, ST.sligo);
          return at(e, n, 42_000, 50, 215);
        },
        fly: 4,
        hours: 14,
        hold: 13,
        enter: () => {
          ensureStudy();
          ui().set({ hero: { ...ui().hero, dialMW: 130 } });
          const s = sim().study;
          const label = s && s.topConstraint >= 0 ? s.constraints[s.topConstraint]!.label.split(' after ')[0]! : 'Cunghill to Sligo 110 kV';
          select(label);
        },
        caption: () => {
          const s = sim().study;
          if (!s) return 'Ask for more and the limit appears.';
          const c = s.topConstraint >= 0 ? s.constraints[s.topConstraint]!.label : 'none';
          return s.firmAllMW < s.requestMW ? `Ask for more and the limit appears. Above ${Math.floor(s.firmAllMW)} MW: ${c}.` : 'Even at 150 MW the studied network holds.';
        },
        narration: 'Turn the dial and the limit appears: the circuit that would overload after a single fault, and how often the extra would be curtailed.',
      },
      {
        id: 'evidence',
        title: 'Evidence pack',
        shot: at(528_000, 812_000, 115_000, 50, 195),
        fly: 3,
        hours: 14,
        hold: 12,
        enter: () => {
          ensureStudy();
          select(null);
          ui().set({ hero: { ...ui().hero, dialMW: 50, evidenceOpen: true } });
        },
        caption: 'Everything behind the offer is in the evidence pack: method, cases, limits, conditions and provenance.',
        narration: 'Everything behind the offer is written down: the method, the cases, the limits, the conditions, and where each number comes from.',
      },
      {
        id: 'decide',
        title: 'Decision',
        shot: at(ST.bellacorick[0] + 900, ST.bellacorick[1] - 600, 5_500, 60, 220),
        fly: 4,
        hours: 14,
        hold: 6,
        enter: () => {
          ensureStudy();
          ui().set({ hero: { ...ui().hero, dialMW: 50, evidenceOpen: false } });
        },
        waitFor: () => !!ui().hero.decision,
        caption: 'A person decides. The decision, the rule set and the inputs are logged.',
        narration: 'The decision belongs to a person. Approve, reject or modify; whichever it is, it is logged with the rule set and the inputs it was made on.',
      },
      {
        id: 'connected',
        title: 'Connected',
        shot: at(560_000, 805_000, 210_000, 44, 200),
        fly: 5,
        hours: 14,
        timeTo: 20,
        hold: 12,
        caption: () => (ui().hero.decision === 'rejected' ? 'Rejected and logged. Nothing is connected.' : `Connected in the model: ${ui().hero.offeredMW ?? 50} MW now flows through the north Mayo network.`),
        narration: 'In the model, the new demand now flows through the north Mayo network, and the agents watch it like everything else.',
      },
    ],
  },

  storm: {
    id: 'storm',
    title: 'Storm event',
    beats: [
      {
        id: 'front',
        title: 'The front',
        shot: at(470_000, 790_000, 430_000, 46, 250),
        fly: 3,
        hours: 10,
        timeTo: 11.6,
        hold: 12,
        enter: () => {
          ensure('storm');
          panels();
          select(null);
        },
        caption: '18 November. A deep Atlantic low reaches the west coast, gusting past turbine cut-out.',
        narration: 'November. A deep Atlantic low reaches the west coast. Gusts take some turbines past their cut-out speed.',
      },
      {
        id: 'comms',
        title: 'Comms lost',
        shot: at(545_000, 805_000, 230_000, 42, 205),
        fly: 4,
        hours: 11.6,
        timeTo: 11.95,
        hold: 11,
        caption: '11:45. Communications to the north west are lost. Agents there hold their last known values, and say so.',
        narration: 'At a quarter to twelve, communications to the north west are lost. The agents there keep their last known values and mark them as stale.',
      },
      {
        id: 'trip',
        title: 'Trip',
        shot: () => {
          const [e, n] = mid(ST.flagford, ST.srananagh);
          return at(e, n, 48_000, 50, 160);
        },
        fly: 4,
        hours: 12,
        hold: 10,
        enter: () => {
          ensure('storm');
          select('Flagford to Srananagh 220 kV');
        },
        caption: '12:00. Flagford to Srananagh 220 kV trips. Power swings onto the 110 kV network.',
        narration: 'At noon, the Flagford to Srananagh 220 kV line trips. Its power swings onto the smaller 110 kV circuits.',
      },
      {
        id: 'overload',
        title: 'Overload',
        shot: () => {
          const [e, n] = mid(ST.carrick, ST.arigna);
          return at(e, n, 24_000, 54, 200);
        },
        fly: 4,
        hours: 12.05,
        hold: 11,
        enter: () => {
          ensure('storm');
          select('Carrick-on-Shannon to Arigna 110 kV');
          sim().setInputs({ stalePolicy: 'consistency' });
        },
        caption: 'Carrick-on-Shannon to Arigna is over its rating. The coordinator proposes relief, but the best actions sit behind the lost link and are withheld.',
        narration: 'Carrick-on-Shannon to Arigna is now overloaded. The coordinator proposes relief, but the most effective assets are behind the lost link, so it withholds them.',
      },
      {
        id: 'policy',
        title: 'Policy',
        shot: () => {
          const [e, n] = mid(ST.carrick, ST.arigna);
          return at(e, n, 30_000, 50, 235);
        },
        fly: 3,
        hours: 12.05,
        hold: 8,
        enter: () => {
          ensure('storm');
          select('Carrick-on-Shannon to Arigna 110 kV');
          sim().setInputs({ stalePolicy: 'availability' });
        },
        waitFor: () => Object.keys(ui().decisions).some((k) => k.startsWith('R-48-')),
        caption: 'Prefer availability: use the last known values. More relief, less confidence. The choice is the operator’s.',
        narration: 'Switch to prefer availability and it uses the last known values: more relief, lower confidence. Which to accept is the operator’s call.',
      },
      {
        id: 'recover',
        title: 'Recovery',
        shot: at(560_000, 805_000, 240_000, 44, 200),
        fly: 5,
        hours: 12.1,
        timeTo: 15,
        hold: 13,
        enter: () => select(null),
        caption: () => {
          const d = Object.entries(ui().decisions).find(([k]) => k.startsWith('R-48-'))?.[1];
          return d === 'rejected' ? 'Rejected and logged. The overload stands until the operator acts another way.' : 'Approved and logged. Loading falls back within rating while the line is restored.';
        },
        narration: 'The decision is logged, with the rule set and the inputs it was made on.',
      },
    ],
  },

  y2034: {
    id: 'y2034',
    title: '2034',
    beats: [
      {
        id: 'now',
        title: '2026',
        shot: national,
        fly: 3,
        hours: 18,
        hold: 10,
        enter: () => {
          ensure('y2034');
          panels();
          select(null);
          sim().setInputs({ year: 2026 });
        },
        caption: 'A winter evening at today’s demand. Data centres take about a fifth of the Republic’s electricity.',
        narration: 'A winter evening at today’s level of demand.',
      },
      {
        id: 'grow',
        title: 'Growth',
        shot: at(dub.e - 20_000, dub.n, 140_000, 48, 170),
        fly: 5,
        hours: 18,
        hold: 13,
        enter: (later) => {
          for (let y = 2027; y <= 2034; y++) later((y - 2027) * 1_300, () => sim().setInputs({ year: y }));
        },
        caption: () => `${sim().inputs.year ?? 2034}. Data centre demand grows towards 31% of the total.`,
        narration: 'Now let demand grow to 2034, with data centres reaching almost a third of the total.',
      },
      {
        id: 'corridors',
        title: 'Five corridors',
        shot: national,
        fly: 4,
        hours: 18,
        hold: 11,
        enter: () => {
          ensure('y2034');
          sim().setInputs({ year: 2034 });
          select(null);
        },
        caption: 'Five corridors carry most of the strain, measured as energy above rating after any single fault.',
        narration: 'Five corridors carry most of the strain.',
      },
      corridorBeat(0),
      corridorBeat(1),
      corridorBeat(2),
      corridorBeat(3),
      corridorBeat(4),
      {
        id: 'close',
        title: 'Close',
        shot: { ...national, polar: 38, az: 10 },
        fly: 5,
        hours: 18,
        hold: 12,
        enter: () => select(null),
        caption: 'This is where reinforcement, flexible demand and siting choices matter most. Every figure here is synthetic and labelled.',
        narration: 'This is where reinforcement, flexible demand and siting choices matter most.',
      },
    ],
  },
};

export const beatText = (v: string | (() => string)) => (typeof v === 'function' ? v() : v);
export const worldHours = () => useWorld.getState().hours;
