/** Toast, log, badge, key hints, confirmation, Method and assumptions, debug readout. */
import { useEffect, useState } from 'preact/hooks';
import { assumptionTable, SITE } from '../config/assumptions.ts';
import { BRANDING } from '../config/branding.ts';
import { clockLabel } from '../lib/format.ts';
import { confirmReq, debugOpen, dockOpen, lens, logOpen, methodOpen, selected, snap, toast } from '../app/store.ts';
import type { StageStats } from '../scene/stage.ts';
import { THERMO_RANGE, VOLTAGE_COLOUR } from '../scene/flow.ts';
import { Icon } from './icons.tsx';

export function Toast() {
  const t = toast.value;
  useEffect(() => {
    if (!t) return;
    const h = setTimeout(() => { if (toast.value?.key === t.key) toast.value = null; }, 8000);
    return () => clearTimeout(h);
  }, [t?.key]);
  if (!t) return null;
  const r = t.result;
  return (
    <div class={`toast panel ${r.ok ? '' : 'bad'}`} role="status" aria-live="polite" key={t.key}>
      <div class="h">{r.ok ? r.title : 'Not possible'}</div>
      <div class="d">{r.ok ? r.detail : r.reason}</div>
      {r.deltas.length > 0 && (
        <div class="chips num">
          {r.deltas.map((d) => <span key={d.key}>{d.label} {d.before.toFixed(d.digits)} to {d.after.toFixed(d.digits)}{d.unit === '%' ? '%' : ` ${d.unit}`}</span>)}
          {r.settling && <span><em>when settled</em></span>}
        </div>
      )}
    </div>
  );
}

export function Log() {
  const s = snap.value;
  if (!s || !logOpen.value) return null;
  const rows = s.log.slice(-40).reverse();
  return (
    <section class="log panel" aria-label="Station log">
      <header><span>STATION LOG</span><button class="iconbtn" style={{ width: '22px', height: '22px' }} aria-label="Hide log" onClick={() => (logOpen.value = false)}><Icon name="x" size={11} /></button></header>
      <div class="rows">
        {rows.length === 0 && <div class="row"><span class="t num">--:--</span><span>Normal operation. Events appear here.</span></div>}
        {rows.map((l, i) => (
          <div class={`row ${l.kind}`} key={`${l.t}-${i}`} onClick={() => l.id && (selected.value = l.id)} style={{ cursor: l.id ? 'pointer' : 'default' }}>
            <span class="t num">{clockLabel(SITE.epochUtcMs.value, l.t).slice(-5)}</span><span>{l.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Badge() {
  return <div class="badge panel">{BRANDING.badge}</div>;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Key to the Flow lens: what moves, what the colours mean, and the thermography scale. */
export function FlowLegend() {
  if (lens.value !== 'flow') return null;
  return (
    <div class="legend panel" role="note" aria-label="Flow lens legend">
      <div class="lg-title">Flow lens</div>
      <div class="lg-row">Particles move with the power flow. Speed is proportional to MW; glow shows loading.</div>
      <div class="lg-volts">
        {([400, 275, 220, 110] as const).map((v) => <span key={v}><i style={{ background: hex(VOLTAGE_COLOUR[v]) }} />{v} kV</span>)}
        <span><i class="dead" />de-energised</span>
      </div>
      <div class="lg-row">Transformer thermography (oil and winding)</div>
      <div class="lg-ramp"><b /><span class="num">{THERMO_RANGE[0]} °C</span><span class="num">{THERMO_RANGE[1]} °C</span></div>
    </div>
  );
}

export function Keys() {
  return (
    <div class="keys panel" aria-hidden="true">
      <kbd>Space</kbd>pause<kbd>→</kbd>tour<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd>lens<kbd>S</kbd>scenarios<kbd>A</kbd>agents<kbd>Ctrl K</kbd>palette<kbd>T</kbd>theme<kbd>H</kbd>overview<kbd>M</kbd>method<kbd>D</kbd>debug<kbd>Esc</kbd>clear
    </div>
  );
}

export function Confirm() {
  const c = confirmReq.value;
  if (!c) return null;
  const close = () => (confirmReq.value = null);
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && close()}>
      <div class="modal small panel" role="alertdialog" aria-modal="true" aria-labelledby="cf-title">
        <h2 id="cf-title">{c.title}</h2>
        <p>{c.body}</p>
        <div class="row-actions">
          <button class="btn" onClick={close} autoFocus>Cancel</button>
          <button class={`btn ${c.danger ? 'danger' : 'primary'}`} onClick={() => { close(); c.run(); }}>{c.action}</button>
        </div>
      </div>
    </div>
  );
}

export function Method() {
  if (!methodOpen.value) return null;
  const rows = assumptionTable();
  let group = '';
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && (methodOpen.value = false)}>
      <div class="modal panel" role="dialog" aria-modal="true" aria-labelledby="m-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div>
            <h2 id="m-title">Method and assumptions</h2>
            <p>Every figure in the simulation, with its source type. Typical values come from recognised references; assumptions are chosen for this fictional station; simplifications are things the model deliberately does not do.</p>
          </div>
          <button class="iconbtn" aria-label="Close" onClick={() => (methodOpen.value = false)}><Icon name="x" size={13} /></button>
        </div>
        <table>
          <thead><tr><th>Item</th><th>Value</th><th>Source</th><th>Reference and note</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const head = r.group !== group ? (group = r.group, <tr key={`g-${r.group}`}><td class="grp" colSpan={4}>{r.group}</td></tr>) : null;
              return [head, (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td class="num">{`${r.value} ${r.unit}`.trim()}</td>
                  <td><span class="src">{r.source}</span></td>
                  <td>{[r.ref, r.note].filter(Boolean).join('. ')}</td>
                </tr>
              )];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Debug({ stats }: { stats: () => StageStats }) {
  const [s, setS] = useState(stats());
  useEffect(() => {
    if (!debugOpen.value) return;
    const h = setInterval(() => setS(stats()), 500);
    return () => clearInterval(h);
  }, [debugOpen.value]);
  if (!debugOpen.value) return null;
  return (
    <div class="debug panel num">
      <span>{s.fps.toFixed(0)} fps</span><span>{s.frameMs.toFixed(1)} ms</span><span>{s.drawCalls} draws</span>
      <span>{(s.triangles / 1e6).toFixed(2)} M tris</span><span>{s.backend}</span><span>tier {s.tier}</span>
    </div>
  );
}

export function DockToggle() {
  if (dockOpen.value) return null;
  return (
    <button class="iconbtn panel" style={{ position: 'absolute', top: '72px', left: '12px', width: '34px', height: '34px' }} aria-label="Show scenarios" title="Scenarios (S)" onClick={() => (dockOpen.value = true)}>
      <Icon name="list" />
    </button>
  );
}
