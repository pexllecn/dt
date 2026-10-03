import { useEffect, useMemo } from 'react';
import { deriveOffer, type Offer } from '@/agents/offer';
import { northWestLargeUser } from '@/config/system';
import { presentation } from '@/config/presentation';
import { useSim } from '@/sim/client';
import type { StudyBundle, StudyResult } from '@/sim/studies';
import { SourceTag } from './SourceTag';
import { useUi } from './uiStore';

const RANGE_MW = 150;

/** One study as a strip: firm MW per interval against the requested level. */
function Strip({ st, requested, dial, constraints }: { st: StudyResult; requested: number; dial: number; constraints: StudyBundle['constraints'] }) {
  const W = 360;
  const H = 20;
  const n = st.firmMW.length;
  const y = (v: number) => H - (Math.min(v, RANGE_MW) / RANGE_MW) * (H - 2) - 1;
  const d = st.firmMW.map((v, i) => `${i ? 'L' : 'M'}${((i / (n - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const min = Math.min(...st.firmMW);
  const at = st.firmMW.indexOf(min);
  const binding = st.binding[at]! >= 0 ? constraints[st.binding[at]!]!.label : null;
  return (
    <div className="mt-1.5">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-ink">
          {st.title}
          {st.days > 1 && <span className="text-ink-faint"> · {st.days} days</span>}
        </span>
        <span className="figure text-ink-soft">min {Math.floor(min)} MW</span>
      </div>
      <svg width={W} height={H} className="mt-1 block" aria-label={`${st.title}: firm capacity per interval`}>
        <path d={`${d}L${W},${H}L0,${H}Z`} fill="var(--ink)" opacity={0.07} />
        <path d={d} fill="none" stroke="var(--ink)" strokeWidth={1} />
        <line x1={0} x2={W} y1={y(requested)} y2={y(requested)} stroke="var(--crimson)" strokeWidth={0.75} strokeDasharray="3 3" />
        {dial !== requested && <line x1={0} x2={W} y1={y(dial)} y2={y(dial)} stroke="var(--amber)" strokeWidth={0.75} />}
        {st.days > 1 && Array.from({ length: st.days - 1 }, (_, i) => <line key={i} x1={((i + 1) / st.days) * W} x2={((i + 1) / st.days) * W} y1={0} y2={H} stroke="var(--hairline)" />)}
      </svg>
      <p className="truncate text-[10px] leading-snug text-ink-faint" title={binding ?? st.description}>
        {binding && min < RANGE_MW ? `Limit: ${binding}` : st.description}
      </p>
    </div>
  );
}

function useHero() {
  const meta = useSim((s) => s.meta);
  const study = useSim((s) => s.study);
  const agents = useSim((s) => s.agents);
  const ui = useUi();
  const bus = meta?.largeLoads.find((l) => l.id === northWestLargeUser.id)?.bus ?? null;
  const requested = northWestLargeUser.capacity.value;
  const dial = ui.hero.dialMW ?? requested;
  const offer: Offer | null = useMemo(() => (study && agents ? deriveOffer(study, dial, agents.trace) : null), [study, agents, dial]);
  return { meta, study, bus, requested, dial, offer, ui };
}

/** Hero scenario: the connection request, its studies, the conditional offer and the decision. */
export function HeroPanel() {
  const { study, bus, requested, dial, offer, ui } = useHero();
  const scenario = useSim((s) => s.inputs.scenario);
  const running = useSim((s) => s.studyRunning);
  const runStudy = useSim((s) => s.runStudy);
  const inputs = useSim((s) => s.inputs);
  const setInputs = useSim((s) => s.setInputs);

  // Deep link: ?studies runs them straight away (rehearsal and screenshots).
  useEffect(() => {
    if (scenario === 'hero' && bus && !study && !running && new URLSearchParams(location.search).has('studies')) runStudy(bus, requested, RANGE_MW);
  }, [scenario, bus, study, running, runStudy, requested]);

  if (scenario !== 'hero' || !bus) return null;
  const decide = (decision: 'approved' | 'rejected' | 'modified and approved') => {
    if (!offer || !study) return;
    if (decision !== 'rejected') setInputs({ extraLoad: { ...inputs.extraLoad, [bus]: offer.offeredMW } });
    ui.record({
      at: new Date().toISOString(),
      simHour: 0,
      scenario: 'hero',
      operator: 'Presenter',
      decision,
      recommendationId: `OFFER-${northWestLargeUser.id}`,
      title: `Connection offer: ${offer.offeredMW} MW at ${study.busLabel} (${offer.firmMW} MW firm)`,
      actions: [{ assetName: northWestLargeUser.name, deltaMW: decision === 'rejected' ? 0 : offer.offeredMW }],
      ruleSetVersion: useSim.getState().meta?.ruleSetVersion ?? '',
      ruleSetHash: useSim.getState().meta?.ruleSetHash ?? '',
      inputsHash: study.method.slice(0, 14),
      note: offer.conditions.map((c) => c.text).join(' | '),
    });
    ui.set({ hero: { ...ui.hero, decision, offeredMW: offer.offeredMW } });
    ui.say(
      decision === 'rejected'
        ? 'Offer withdrawn and logged. Nothing is connected.'
        : `Offer approved and logged. ${offer.offeredMW} MW now appears in the simulation at ${study.busLabel}.`,
    );
  };

  return (
    <section
      className="absolute left-8 top-[124px] z-20 max-h-[calc(100%-250px)] w-[408px] overflow-y-auto border border-ink px-5 pb-4 pt-4 backdrop-blur-md"
      style={{ background: 'var(--panel)' }}
      aria-label="Connection request"
    >
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] text-crimson">{ui.hero.decision ? `Offer ${ui.hero.decision}` : study ? 'Conditional offer · awaiting decision' : 'Connection request'}</p>
        <SourceTag s="Assumption" />
      </div>
      <h3 className="caption mt-1.5 text-[21px] leading-tight text-ink">
        {requested} MW for a {presentation.showHeroPlaceLabel ? 'large energy user in north Mayo' : 'large energy user in the north west'}
      </h3>
      <table className="figure mt-2 w-full text-[11px]">
        <tbody>
          <tr>
            <td className="py-0.5 pr-3 text-ink-faint">customer</td>
            <td className="text-ink">{northWestLargeUser.name} (hypothetical)</td>
          </tr>
          <tr>
            <td className="py-0.5 pr-3 text-ink-faint">connection point</td>
            <td className="text-ink">
              Bellacorick 110 kV <span className="text-crimson">connection point assumed</span>
            </td>
          </tr>
          <tr>
            <td className="py-0.5 pr-3 text-ink-faint">profile</td>
            <td className="text-ink">near flat, load factor 0.92</td>
          </tr>
        </tbody>
      </table>

      {!study && (
        <div className="mt-4 border-t hairline pt-3">
          <p className="text-[12px] leading-snug text-ink-soft">
            Four studies: a typical day, winter peak, a low-wind week and the main feed out of service. Each finds the firm capacity in every 15-minute interval, intact and after any single outage.
          </p>
          <button
            className="mt-3 border border-ink bg-ink px-4 py-1.5 text-[12px] text-ground disabled:opacity-60"
            disabled={running}
            onClick={() => runStudy(bus, requested, RANGE_MW)}
          >
            {running ? 'Running studies…' : 'Run connection studies'}
          </button>
        </div>
      )}

      {study && offer && (
        <>
          <div className="mt-3 border-t hairline pt-1">
            {study.studies.map((st) => (
              <Strip key={st.id} st={st} requested={requested} dial={dial} constraints={study.constraints} />
            ))}
            <p className="mt-1.5 flex gap-4 text-[10px] text-ink-faint">
              <span>
                <span className="mr-1 inline-block w-4 border-t border-dashed border-crimson align-middle" /> requested
              </span>
              <span>firm MW per interval, 0 to {RANGE_MW}</span>
              <span className="ml-auto">
                <SourceTag s="Synthetic" />
              </span>
            </p>
          </div>

          <div className="mt-3 border-t hairline pt-2.5">
            <div className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.16em] text-ink-soft">
              <span>Firmness dial</span>
              <span className="figure normal-case tracking-normal text-ink">{dial} MW</span>
            </div>
            <input
              type="range"
              min={10}
              max={RANGE_MW}
              step={5}
              value={dial}
              onChange={(e) => ui.set({ hero: { ...ui.hero, dialMW: Number(e.target.value) } })}
              className="specimen-range mt-1 w-full"
              aria-label="Firmness dial"
            />
            <div className="mt-1 grid grid-cols-3 gap-2">
              <div>
                <p className="text-[10px] text-ink-faint">firm</p>
                <p className="figure text-[16px] text-ink">{Math.floor(offer.firmMW)} MW</p>
              </div>
              <div>
                <p className="text-[10px] text-ink-faint">firm in</p>
                <p className={`figure text-[16px] ${offer.firmShare < 0.999 ? 'text-amber' : 'text-ink'}`}>{Math.round(offer.firmShare * 1000) / 10}% of year</p>
              </div>
              <div>
                <p className="text-[10px] text-ink-faint">curtailed</p>
                <p className="figure text-[16px] text-ink">{Math.round(offer.curtailedMWhYear)} MWh/yr</p>
              </div>
            </div>
            <p className="mt-1 text-[10.5px] leading-snug text-ink-soft">
              Firm in every studied interval up to {Math.floor(study.firmAllMW)} MW.
              {offer.limitConstraint && study.firmAllMW < study.requestMW && <> Above that: {offer.limitConstraint}.</>}
            </p>
          </div>

          <div className="mt-3 border-t hairline pt-2.5">
            <p className="text-[10px] uppercase tracking-[0.16em] text-ink-soft">Conditions</p>
            {offer.conditions.length === 0 && <p className="mt-1 text-[12px] text-ink">None: the level is firm and no findings are open on the circuits that carry it.</p>}
            <ol className="mt-1">
              {offer.conditions.map((c, i) => (
                <li key={i} className="mt-1 text-[11.5px] leading-snug text-ink">
                  <span className="text-ink-faint">{i + 1}. </span>
                  {c.text} <span className="figure text-[10px] text-ink-faint">{c.basis}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-4 flex items-center gap-3">
            {!ui.hero.decision ? (
              <>
                <button className="border border-ink bg-ink px-4 py-1.5 text-[12px] text-ground" onClick={() => decide(dial === requested ? 'approved' : 'modified and approved')}>
                  {dial === requested ? 'Approve offer' : `Approve at ${dial} MW`}
                </button>
                <button className="border border-ink px-4 py-1.5 text-[12px] text-ink" onClick={() => decide('rejected')}>
                  Reject
                </button>
              </>
            ) : (
              <p className="caption text-[14px] text-ink">Decision logged to the audit trail.</p>
            )}
            <button className="ml-auto text-[12px] text-ink underline underline-offset-4" onClick={() => ui.set({ hero: { ...ui.hero, evidenceOpen: true } })}>
              Evidence pack
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** The evidence pack: everything behind the offer, printable and exportable. */
export function EvidencePack() {
  const { study, requested, dial, offer, ui, meta } = useHero();
  if (!ui.hero.evidenceOpen || !study || !offer || !meta) return null;
  const date = new Date().toLocaleDateString('en-IE', { day: 'numeric', month: 'long', year: 'numeric' });
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ study, offer, ruleSet: { version: meta.ruleSetVersion, hash: meta.ruleSetHash } }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'evidence-pack-nw-leu.json';
    a.click();
  };
  const p10 = (st: StudyResult) => [...st.firmMW].sort((a, b) => a - b)[Math.floor(st.firmMW.length * 0.1)]!;
  return (
    <section
      className="evidence absolute left-1/2 top-1/2 z-50 flex h-[min(780px,calc(100%-80px))] w-[760px] -translate-x-1/2 -translate-y-1/2 flex-col border border-ink backdrop-blur-md"
      style={{ background: 'var(--panel)' }}
      role="dialog"
      aria-label="Evidence pack"
    >
      <header className="flex items-baseline justify-between border-b hairline px-8 pb-3 pt-6">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-ink-soft">Evidence pack · {date}</p>
          <h2 className="caption mt-1 text-[26px] leading-tight text-ink">
            Connection of {requested} MW at {study.busLabel}
          </h2>
        </div>
        <div className="flex gap-4 text-[11px]">
          <button className="text-ink underline underline-offset-4" onClick={() => window.print()}>
            print
          </button>
          <button className="text-ink underline underline-offset-4" onClick={exportJson}>
            export JSON
          </button>
          <button className="text-ink-soft underline underline-offset-4" onClick={() => ui.set({ hero: { ...ui.hero, evidenceOpen: false } })}>
            close
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-8 pb-6 text-[12.5px] leading-relaxed text-ink">
        <h3 className="mt-4 text-[10px] uppercase tracking-[0.16em] text-ink-soft">1. Request</h3>
        <p>
          {northWestLargeUser.name} (hypothetical) requests {requested} MW of demand, near flat. Connection point assumed: the nearest existing 110 kV station in north Mayo, {study.busLabel}.{' '}
          <SourceTag s="Assumption" />
        </p>

        <h3 className="mt-4 text-[10px] uppercase tracking-[0.16em] text-ink-soft">2. Method</h3>
        <p>
          {study.method}. Firm capacity in each 15-minute interval is the largest new demand for which every affected circuit stays within {Math.round(study.limits.intact * 100)}% of its rating
          with everything in service and within {Math.round(study.limits.postFault * 100)}% after any single outage (short-term emergency rating, the same limit the day-ahead schedule uses). New
          demand is met pro-rata by the large synchronous units. A circuit counts as affected when the new demand changes its flow by at least 5%. <SourceTag s="Assumption" />
        </p>

        <h3 className="mt-4 text-[10px] uppercase tracking-[0.16em] text-ink-soft">3. Studies</h3>
        <table className="figure mt-1 w-full text-[11.5px]">
          <thead className="text-ink-faint">
            <tr className="border-b hairline text-left">
              <th className="py-1 pr-3 font-normal">case</th>
              <th className="py-1 pr-3 font-normal">intervals</th>
              <th className="py-1 pr-3 font-normal">min firm</th>
              <th className="py-1 pr-3 font-normal">10th pct</th>
              <th className="py-1 font-normal">limit at minimum</th>
            </tr>
          </thead>
          <tbody>
            {study.studies.map((st) => {
              const min = Math.min(...st.firmMW);
              const b = st.binding[st.firmMW.indexOf(min)]!;
              return (
                <tr key={st.id} className="border-b hairline align-top">
                  <td className="py-1 pr-3 font-sans">{st.title}</td>
                  <td className="py-1 pr-3">{st.firmMW.length}</td>
                  <td className="py-1 pr-3">{Math.floor(min)} MW</td>
                  <td className="py-1 pr-3">{Math.floor(p10(st))} MW</td>
                  <td className="py-1 font-sans text-[11px] text-ink-soft">{b >= 0 ? study.constraints[b]!.label : `none up to ${study.requestMW} MW`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-1 text-[11px] text-ink-soft">
          Main feed: {study.mainFeed.label}. Studies computed in {Math.round(study.ms)} ms. <SourceTag s="Synthetic" />
        </p>

        <h3 className="mt-4 text-[10px] uppercase tracking-[0.16em] text-ink-soft">4. Result</h3>
        <p>
          Firm in every studied interval up to <span className="figure">{Math.floor(study.firmAllMW)} MW</span>
          {study.topConstraint >= 0 && study.firmAllMW < study.requestMW ? <>, limited by {study.constraints[study.topConstraint]!.label}</> : null}.{' '}
          {study.firmIfRelievedMW - study.firmAllMW >= 2 ? (
            <>
              Relieving that constraint (for example by uprating) would raise the firm level to about <span className="figure">{Math.floor(study.firmIfRelievedMW)} MW</span> (indicative).
            </>
          ) : study.firmAllMW < study.requestMW ? (
            <>Relieving that circuit alone would not help: the circuits in series with it bind at the same level, so reinforcement would need the corridor as a whole.</>
          ) : null}
        </p>
        <p className="mt-1">
          Offer at <span className="figure">{dial} MW</span>: <span className="figure">{Math.floor(offer.firmMW)} MW</span> firm
          {offer.nonFirmMW > 0 && (
            <>
              , <span className="figure">{Math.round(offer.nonFirmMW)} MW</span> non-firm
            </>
          )}
          ; firm in {Math.round(offer.firmShare * 1000) / 10}% of the year (typical days weighted 250, winter peak 60, low wind 55 days). <SourceTag s="Assumption" />
        </p>

        <h3 className="mt-4 text-[10px] uppercase tracking-[0.16em] text-ink-soft">5. Conditions</h3>
        {offer.conditions.length ? (
          <ol className="list-decimal pl-5">
            {offer.conditions.map((c, i) => (
              <li key={i}>
                {c.text} <span className="figure text-[10.5px] text-ink-faint">({c.kind}; {c.basis})</span>
              </li>
            ))}
          </ol>
        ) : (
          <p>None.</p>
        )}

        <h3 className="mt-4 text-[10px] uppercase tracking-[0.16em] text-ink-soft">6. Circuits carrying the new demand</h3>
        <p className="text-[11.5px]">{study.affected.map((a) => `${a.label} (${Math.round(a.share * 100)}%)`).join(' · ')}</p>

        <h3 className="mt-4 text-[10px] uppercase tracking-[0.16em] text-ink-soft">7. Pre-existing constraints (not attributed)</h3>
        <p className="text-[11.5px]">{study.preExisting.length ? study.preExisting.slice(0, 8).join(' · ') + (study.preExisting.length > 8 ? ` and ${study.preExisting.length - 8} more` : '') : 'None on affected circuits.'}</p>

        <h3 className="mt-4 text-[10px] uppercase tracking-[0.16em] text-ink-soft">8. Provenance</h3>
        <p className="text-[11.5px]">
          Rule set v{meta.ruleSetVersion} ({meta.ruleSetHash}). Network geometry from OpenStreetMap via Overture Maps (ODbL), approximate. Ratings, reactances and unit data by class or public figure,
          as labelled in the Method notes. No live data is used.
        </p>
        <p className="mt-4 border-t hairline pt-2 text-[10.5px] text-ink-faint">{presentation.dataBadge}</p>
      </div>
    </section>
  );
}
