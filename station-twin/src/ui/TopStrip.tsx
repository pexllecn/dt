/** Slim top strip: identity, clock, condition, import against limits, N-1, renewables, frequency, lenses. */
import { BRANDING } from '../config/branding.ts';
import { CLOCK, RATINGS, SITE } from '../config/assumptions.ts';
import { clockLabel, compressionLabel } from '../lib/format.ts';
import { clock, lens, methodOpen, sankeyOpen, snap, theme, tour } from '../app/store.ts';
import type { SimClient } from '../app/client.ts';
import { Icon } from './icons.tsx';

export function TopStrip({ client }: { client: SimClient }) {
  const s = snap.value;
  const c = clock.value;
  if (!s) return null;
  const g = s.results.gridFlow;
  const importing = g >= 0;
  const limit = importing ? RATINGS.gridImport.value : RATINGS.gridExport.value;
  const n1 = s.contingency;
  const n1Text = n1.lossOfT1 === null ? 'not applicable' : `${(n1.worst * 100).toFixed(0)}%`;
  const f = s.frequency;
  const fClass = (v: number) => (Math.abs(v - 50) > 0.2 ? 'fault' : Math.abs(v - 50) > 0.1 ? 'warn' : '');
  const localPct = s.results.localDemand > 0 ? (s.results.localGeneration / s.results.localDemand) * 100 : 0;
  return (
    <div class="top panel" role="banner">
      <div class="brand"><b>{BRANDING.product}</b><span>{BRANDING.station} · {BRANDING.stationDetail}</span></div>
      <div class="cell clock">
        <span class="time num" title="Simulated time">{clockLabel(SITE.epochUtcMs.value, s.t)}</span>
        <button class="iconbtn" aria-label={c.paused ? 'Play' : 'Pause'} title={c.paused ? 'Play (Space)' : 'Pause (Space)'} onClick={() => client.setClock({ paused: !c.paused })}>
          <Icon name={c.paused ? 'play' : 'pause'} size={13} />
        </button>
        <select class="compact num" aria-label="Time compression" value={String(c.compression)} onChange={(e) => client.setClock({ compression: Number((e.target as HTMLSelectElement).value) })}>
          {CLOCK.compressions.value.map((v) => <option value={String(v)}>{compressionLabel(v)}</option>)}
        </select>
        {c.effective !== c.compression && <span class="chip warn num">Time-lapse {compressionLabel(c.effective)}</span>}
      </div>
      <div class="cell">
        <span class="k">Station condition</span>
        <span class="v cond" data-c={s.condition}><i />{s.condition}</span>
      </div>
      <div class="cell" title={`400 kV ${importing ? 'import' : 'export'} against its ${limit} MW limit`}>
        <span class="k">400 kV {importing ? 'import' : 'export'}</span>
        <span class="v num">{Math.abs(g).toFixed(0)} MW<small>of {limit}</small></span>
        <span class="bar"><i style={{ width: `${Math.min(100, (Math.abs(g) / limit) * 100)}%` }} /></span>
      </div>
      <div class="cell" title="Loading of the remaining 400/220 kV unit if the other is lost. Secure up to 130%.">
        <span class="k">N-1 loading</span>
        <span class={`v num ${n1.lossOfT1 === null ? '' : n1.secure ? '' : 'fault'}`}>{n1Text}<small>{n1.lossOfT1 === null ? '' : n1.secure ? 'secure' : 'insecure'}</small></span>
      </div>
      <div class="cell opt" title="Local wind and solar as a share of station supply">
        <span class="k">Renewables</span>
        <span class="v num">{s.results.renewPct.toFixed(0)}%</span>
      </div>
      <div class="cell opt click" title="Local generation against local demand. Click for the supply and demand diagram." onClick={() => (sankeyOpen.value = true)}>
        <span class="k">Local supply</span>
        <span class="v num">{s.results.localGeneration.toFixed(0)}<small>of {s.results.localDemand.toFixed(0)} MW ({localPct.toFixed(0)}%)</small></span>
      </div>
      <div class="cell opt" title="System frequency from the all-island model (an assumption, not a dynamic study)">
        <span class="k">{f.coupled ? 'System frequency' : 'Ireland / N. Ireland'}</span>
        <span class="v num">
          {f.coupled
            ? <span class={fClass(f.ireland)}>{f.ireland.toFixed(2)} Hz</span>
            : <><span class={fClass(f.ireland)}>{f.ireland.toFixed(2)}</span> / <span class={fClass(f.ni)}>{f.ni.toFixed(2)} Hz</span></>}
        </span>
      </div>
      <div class="spacer" />
      <div class="lenses" role="tablist" aria-label="Lens">
        <button class={lens.value === 'physical' ? 'on' : ''} role="tab" aria-selected={lens.value === 'physical'} title="Physical (1)" onClick={() => (lens.value = 'physical')}>Physical</button>
        <button class={lens.value === 'flow' ? 'on' : ''} role="tab" aria-selected={lens.value === 'flow'} title="Flow: power flow, loading and thermography (2)" onClick={() => (lens.value = 'flow')}>Flow</button>
        <button class={lens.value === 'circuit' ? 'on' : ''} role="tab" aria-selected={lens.value === 'circuit'} title="Circuit: the single-line diagram (3)" onClick={() => (lens.value = 'circuit')}>Circuit</button>
      </div>
      <button class={`btn tourbtn ${tour.value ? 'on' : ''}`} title="Guided tour (Right arrow)" onClick={() => client.tour(tour.value ? 'stop' : 'start')}>{tour.value ? 'End tour' : 'Tour'}</button>
      <button class="iconbtn" title="Method and assumptions (M)" aria-label="Method and assumptions" onClick={() => (methodOpen.value = true)}><Icon name="info" /></button>
      <button class={`iconbtn ${theme.value === 'control' ? 'on' : ''}`} style={{ marginLeft: '6px' }} title="Theme: Daylight or Control Room (T)" aria-label="Toggle theme" onClick={() => (theme.value = theme.value === 'daylight' ? 'control' : 'daylight')}>
        <Icon name={theme.value === 'control' ? 'moon' : 'sun'} />
      </button>
      {BRANDING.partnerLogo && <div class="partner"><img src={BRANDING.partnerLogo} alt={BRANDING.partnerName} /></div>}
    </div>
  );
}
