/**
 * Inspector card: appears only when something is selected. Live state, a trend, device states,
 * set-points, and switching actions that always go through an explicit confirmation.
 */
import { useState } from 'preact/hooks';
import { PLANT, PROTECTION, SITE } from '../config/assumptions.ts';
import { clockLabel } from '../lib/format.ts';
import { coolingMode } from '../sim/thermal/iec60076.ts';
import type { Command } from '../sim/engine.ts';
import type { Component, ComponentId, SimState } from '../sim/types.ts';
import type { SimClient } from '../app/client.ts';
import { confirmReq, history, selected, snap, toast } from '../app/store.ts';
import { Icon } from './icons.tsx';
import { agents } from '../app/store.ts';
import { AGENT_NAMES, ALL_RULES, neighbours } from '../agents/agents.ts';
import type { AnyRule } from '../agents/types.ts';

function stateChip(c: Component, s: SimState) {
  if (!c.installed) return <span class="chip dim">Not built</span>;
  if (c.tripped) return <span class="chip fault">Tripped</span>;
  if (c.section && s.sys.busFault.includes(c.section)) return <span class="chip fault">Faulted section</span>;
  if (c.kind !== 'bus' && !c.closed) return <span class="chip warn">Open</span>;
  return c.live ? <span class="chip ok">In service</span> : <span class="chip dim">De-energised</span>;
}

function Spark({ k, unit, digits = 0, limit }: { k: string; unit: string; digits?: number; limit?: number }) {
  const pts = history.get(k) ?? [];
  if (pts.length < 2) return null;
  const vs = pts.map((p) => p.v);
  let lo = Math.min(...vs, limit ?? Infinity);
  let hi = Math.max(...vs, limit ?? -Infinity);
  if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const W = 288, H = 44;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const last = vs[vs.length - 1]!;
  return (
    <div class="spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Trend, latest ${last.toFixed(digits)} ${unit}`}>
        {limit !== undefined && <line x1="0" x2={W} y1={y(limit)} y2={y(limit)} stroke="var(--fault)" stroke-dasharray="3 3" stroke-width="1" vector-effect="non-scaling-stroke" />}
        <path d={d} fill="none" stroke="var(--ink)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
      </svg>
      <div class="cap num"><span>{clockLabel(SITE.epochUtcMs.value, pts[0]!.t).slice(-5)}</span><span>{last.toFixed(digits)} {unit}{limit !== undefined ? ` (limit ${limit})` : ''}</span></div>
    </div>
  );
}

export function Inspector({ client, onFrame }: { client: SimClient; onFrame: (id: ComponentId) => void }) {
  const s = snap.value;
  const id = selected.value;
  const [draft, setDraft] = useState<Record<string, number>>({});
  if (!s || !id) return null;
  const c = s.C[id];
  const send = async (cmd: Command) => { const r = await client.command(cmd); toast.value = { result: r, key: Date.now() }; };
  const confirm = (title: string, body: string, action: string, cmd: Command, danger = false) => {
    confirmReq.value = { title, body, action, danger, run: () => void send(cmd) };
  };
  const rows: [string, string][] = [];
  const mw = (v: number) => `${v.toFixed(0)} MW`;
  let spark: preact.JSX.Element | null = null;
  const controls: preact.JSX.Element[] = [];
  const slider = (key: string, label: string, value: number, min: number, max: number, cmd: (v: number) => Command, fmt = (v: number) => `${v.toFixed(0)} MW`) => {
    const v = draft[key] ?? value;
    controls.push(
      <label class="range" key={key}>
        <span>{label}</span><span class="num">{fmt(v)}</span>
        <input type="range" min={min} max={max} step={1} value={v}
          onInput={(e) => setDraft({ ...draft, [key]: Number((e.target as HTMLInputElement).value) })}
          onChange={(e) => { const n = Number((e.target as HTMLInputElement).value); setDraft({}); void send(cmd(n)); }} />
      </label>,
    );
  };

  switch (c.kind) {
    case 'tx': {
      const mode = coolingMode(c);
      rows.push(['Loading', `${(c.loadPU * 100).toFixed(0)}% (${mw(c.mwNow)} of ${c.cap} MVA)`]);
      rows.push(['Winding hot-spot', `${c.temp.toFixed(1)} °C`]);
      rows.push(['Top oil', `${c.topOil.toFixed(1)} °C`]);
      rows.push(['Cooling', `${mode.label}${c.cool ? ', forced' : ''}`]);
      rows.push(['Ageing rate', `${c.ageingRate.toFixed(2)} × normal`]);
      if (c.alarms.wti || c.alarms.oti) rows.push(['Alarms', [c.alarms.wti && 'winding temperature', c.alarms.oti && 'oil temperature'].filter(Boolean).join(', ')]);
      spark = <Spark k={`${id}.temp`} unit="°C" digits={1} limit={PROTECTION.wtiAlarm.value} />;
      controls.push(<button class="btn" onClick={() => void send({ type: 'forceCooling', id: c.id as 'T1', on: !c.cool })}>{c.cool ? 'Return to automatic cooling' : 'Force all cooling on'}</button>);
      break;
    }
    case 'gen': {
      rows.push(['Output', `${mw(c.mwNow)} of ${c.cap} MW`]);
      rows.push(['Available', mw(c.avail)]);
      if (c.unit === 'wind') rows.push(['Wind speed', `${c.windSpeed.toFixed(1)} m/s${c.cutOut ? ', shut down on high wind' : ''}`]);
      if (c.unit === 'gas') rows.push(['Unit', c.gasState === 'off' ? 'Off' : c.gasState === 'starting' ? 'Starting' : 'Running']);
      spark = <Spark k={`${id}.mw`} unit="MW" />;
      if (c.installed) slider('out', c.unit === 'gas' ? 'Dispatch set-point' : 'Output limit', c.out, 0, c.cap, (v) => ({ type: 'setGeneration', id: c.id as 'GAS', out: v }));
      break;
    }
    case 'bess':
      rows.push(['State of charge', `${c.soc.toFixed(1)}%`]);
      rows.push(['Power', c.mwNow > 0.5 ? `discharging ${mw(c.mwNow)}` : c.mwNow < -0.5 ? `charging ${mw(-c.mwNow)}` : 'idle']);
      rows.push(['Usable range', `${PLANT.batterySocMin.value} to ${PLANT.batterySocMax.value}%`]);
      spark = <Spark k="BESS.soc" unit="%" digits={1} />;
      if (c.installed) slider('set', 'Charge (−) or discharge (+)', c.set, -c.cap, c.cap, (v) => ({ type: 'setBattery', mw: v }));
      break;
    case 'load': {
      rows.push(['Demand supplied', mw(c.mwNow)]);
      rows.push(['Set-point', mw(c.mw)]);
      if (id === 'LD_TOWN') {
        rows.push(['Off supply', mw(s.results.regional.offSupply)]);
        if (s.sys.shedMW > 0) rows.push(['Shed', `${mw(s.sys.shedMW)}, about ${Math.round((s.sys.shedMW * 1000) / 1.5).toLocaleString('en-GB')} household equivalents`]);
        for (const v of [0, 40, 80]) controls.push(<button class="btn" onClick={() => (v === 0 ? void send({ type: 'shed', mw: 0 }) : confirm(`Shed ${v} MW of regional demand?`, `About ${Math.round((v * 1000) / 1.5).toLocaleString('en-GB')} household equivalents lose supply until it is restored.`, `Shed ${v} MW`, { type: 'shed', mw: v }, true))}>{v === 0 ? 'Restore shed demand' : `Shed ${v} MW`}</button>);
      }
      spark = <Spark k={`${id}.mw`} unit="MW" />;
      break;
    }
    case 'tie2':
      rows.push(['Flow', c.mwNow > 0.5 ? `${mw(c.mwNow)} in` : c.mwNow < -0.5 ? `${mw(-c.mwNow)} out` : 'none']);
      rows.push(['Requested', `${c.set >= 0 ? 'in' : 'out'} ${mw(Math.abs(c.set))}`]);
      slider('set', 'Request transfer (− out, + in)', c.set, -c.cap, c.cap, (v) => ({ type: 'requestTransfer', id: c.id as 'TIE_N', mw: v }));
      spark = <Spark k={`${id}.mw`} unit="MW" />;
      break;
    case 'tie':
      rows.push(['Transfer north', mw(c.mwNow)]);
      rows.push(['Scheduled', mw(c.mw)]);
      rows.push(['Island', s.sys.coupled ? 'coupled' : 'split']);
      spark = <Spark k={`${id}.mw`} unit="MW" />;
      break;
    case 'grid':
      rows.push([s.results.gridFlow >= 0 ? 'Import' : 'Export', mw(Math.abs(s.results.gridFlow))]);
      rows.push(['Limits', '900 MW import, 700 MW export']);
      rows.push(['N-1 loading', s.contingency.lossOfT1 === null ? 'not applicable' : `${(s.contingency.worst * 100).toFixed(0)}% (${s.contingency.secure ? 'secure' : 'insecure'})`]);
      spark = <Spark k="GRID.mw" unit="MW" />;
      break;
    case 'bus':
    case 'bussection':
      rows.push(['Throughput', mw(c.mwNow)]);
      if (c.section && s.sys.busFault.includes(c.section)) {
        rows.push(['Fault', 'Earth fault, isolated by bus-zone protection']);
        controls.push(<button class="btn primary" onClick={() => confirm(`Confirm section ${c.section} is clear?`, 'Only confirm when the fault has been found and cleared. Re-energisation then runs as a switching programme, one breaker at a time.', 'Fault confirmed clear', { type: 'clearBusFault', section: c.section!, confirmed: true })}>Confirm fault clear and re-energise</button>);
      }
      break;
  }

  // Switching, always confirmed.
  if (c.installed && c.kind !== 'bus') {
    if (c.tripped) {
      controls.push(<button class="btn primary" onClick={() => confirm(`Reset protection on ${c.name}?`, `${c.tripCause ? `It tripped on ${c.tripCause}. ` : ''}Only reset once the cause has been inspected and cleared. The breaker stays open until it is closed.`, 'Inspected, reset protection', { type: 'resetProtection', id, confirmed: true })}>Reset protection</button>);
    }
    const open = c.closed;
    controls.push(<button class={`btn ${open ? 'danger' : ''}`} onClick={() => confirm(`${open ? 'Open' : 'Close'} the circuit breaker: ${c.name}?`, open ? 'This takes the circuit out of service immediately. Power will reroute where the network allows.' : 'The simulation checks the interlocks before the breaker closes.', open ? 'Open breaker' : 'Close breaker', { type: 'operate', id, device: 'cb', action: open ? 'open' : 'close' }, open)}>{open ? 'Open breaker' : 'Close breaker'}</button>);
    if (c.bay) {
      const isolated = !c.bay.dsBus || !c.bay.dsLine;
      controls.push(<button class="btn" onClick={() => confirm(isolated ? `Return ${c.name} to service?` : `Take ${c.name} out of service?`, isolated ? 'Runs the return-to-service programme: earth switch open, disconnectors closed, then the breaker. Each step is interlocked.' : 'Runs the isolation programme: breaker open, disconnectors open, then the earth switch closed where fitted. Each step is interlocked.', 'Run programme', { type: 'programme', id, programme: isolated ? 'returnToService' : 'outOfService' })}>{isolated ? 'Return to service' : 'Take out of service'}</button>);
    }
  }
  if (!c.installed && (id === 'SOLAR' || id === 'GAS' || id === 'BESS' || id === 'LD_NEW')) {
    controls.push(<button class="btn primary" onClick={() => void send({ type: 'scenario', id: id === 'SOLAR' ? 'add_solar' : id === 'GAS' ? 'add_gas' : id === 'BESS' ? 'add_bess' : 'ie_estate' })}>Build and connect</button>);
  }

  return (
    <aside class="insp panel" aria-label={`${c.name} details`}>
      <button class="iconbtn close" aria-label="Close" title="Close (Esc)" onClick={() => (selected.value = null)}><Icon name="x" size={13} /></button>
      <h3>{c.name}</h3>
      <div class="sub">{c.kv}</div>
      <div style={{ marginTop: '8px', display: 'flex', gap: '6px', alignItems: 'center' }}>
        {stateChip(c, s)}
        <button class="btn" style={{ padding: '2px 8px', fontSize: '11px' }} onClick={() => onFrame(id)}><Icon name="focus" size={12} style={{ verticalAlign: '-2px', marginRight: '4px' }} />Frame</button>
      </div>
      <dl class="kv num">{rows.map(([k, v]) => <><dt>{k}</dt><dd>{v}</dd></>)}</dl>
      {spark}
      {c.bay && (
        <div class="devices" aria-label="Switchgear state">
          <div><b>{c.closed ? 'Closed' : 'Open'}</b>Breaker</div>
          <div><b>{c.bay.dsBus ? 'Closed' : 'Open'}</b>Bus disc.</div>
          <div><b>{c.bay.dsLine ? 'Closed' : 'Open'}</b>Line disc.</div>
          <div><b>{c.bay.es === null ? 'None' : c.bay.es ? 'Earthed' : 'Open'}</b>Earth sw.</div>
        </div>
      )}
      {controls.length > 0 && <div class="actions">{controls}</div>}
      <AgentSection id={id} client={client} />
      <div class="note">{c.note}{c.bay ? ' Breaker indicator lamps: red closed, green open, flashing amber tripped.' : ''}</div>
    </aside>
  );
}

/** The asset's agent: what it is reporting now, its rules and its neighbours. */
function AgentSection({ id, client }: { id: ComponentId; client: SimClient }) {
  const v = agents.value;
  const s = snap.value;
  if (!v || !s) return null;
  const st = v.statuses.find((x) => x.id === id);
  if (!st) return null;
  const isTx = s.C[id].kind === 'tx';
  const rules = rulesFor(id, v.mode);
  const active = rules.filter((r) => st.active.includes(r.id));
  return (
    <div class="agent">
      <div class="ah"><b>Agent</b><span class={`lv ${st.level}`}>{st.level === 'calm' ? 'Calm' : st.level[0]!.toUpperCase() + st.level.slice(1)}</span>
        {isTx && <button class="mat" title="Rule maturity: base alarms only, or the extended set" onClick={() => void client.decide({ type: 'ruleset', mode: v.mode === 'extended' ? 'base' : 'extended' })}><span class={v.mode === 'base' ? 'on' : ''}>Base</span><span class={v.mode === 'extended' ? 'on' : ''}>Extended</span></button>}
      </div>
      {active.length === 0 ? <div class="quiet">{rules.length} rules, none reporting.</div> : (
        <ul>{active.map((r) => <li key={r.id}><span class={`sev ${r.severity}`} /><span class="num">{r.id}</span> {r.description}</li>)}</ul>
      )}
      <div class="nb">Neighbours: {neighbours(id, s).map((n) => AGENT_NAMES[n]).join(', ') || 'none'}</div>
    </div>
  );
}

function rulesFor(id: ComponentId, mode: 'base' | 'extended'): readonly AnyRule[] {
  const R = ALL_RULES;
  if (id === 'T1' || id === 'T2' || id === 'T3' || id === 'T4') return mode === 'extended' ? [...R.TX_BASE, ...R.TX_EXTENDED] : R.TX_BASE;
  if (id.startsWith('BUS')) return R.BUS_RULES;
  if (id === 'WIND') return R.WIND_RULES;
  if (id === 'BESS') return R.BATTERY_RULES;
  if (id === 'GAS') return R.GAS_RULES;
  if (id.startsWith('LD_')) return R.DEMAND_RULES;
  if (id.startsWith('TIE')) return R.TIE_RULES;
  if (id === 'GRID') return R.INFEED_RULES;
  return [];
}
