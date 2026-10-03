/**
 * The agent layer in the interface: the feed (each entry expands to its full trace), the
 * recommendation card with the fan of futures, approval controls, the audit log, the rule-set
 * toggle and the early catch. People decide; the agents explain.
 */
import { useState } from 'preact/hooks';
import { SITE } from '../config/assumptions.ts';
import { clockLabel } from '../lib/format.ts';
import type { SimClient } from '../app/client.ts';
import { agents, auditOpen, confirmReq, feedOpen, hovered, logOpen, operator, selected, snap, toast } from '../app/store.ts';
import { AGENT_NAMES } from '../agents/agents.ts';
import { RANK_ORDER } from '../agents/coordinator.ts';
import type { Option, Recommendation, TraceEntry } from '../agents/types.ts';
import type { ComponentId, TransformerId } from '../sim/types.ts';
import { Icon } from './icons.tsx';

const hhmm = (t: number) => clockLabel(SITE.epochUtcMs.value, t).slice(-5);
const short = (h: string) => h.slice(0, 8);

export function Feed({ onFly }: { onFly: (id: ComponentId) => void }) {
  const [tab, setTab] = useState<'agents' | 'log'>('agents');
  const [open, setOpen] = useState<number | null>(null);
  const v = agents.value;
  const s = snap.value;
  if (!logOpen.value || !s) return null;
  const entries = v ? v.feed.slice(-60).reverse() : [];
  return (
    <section class={`feed panel ${feedOpen.value ? 'tall' : ''}`} aria-label="Agents and station log">
      <header>
        <div class="tabs" role="tablist">
          <button class={tab === 'agents' ? 'on' : ''} role="tab" aria-selected={tab === 'agents'} onClick={() => setTab('agents')}>Agents</button>
          <button class={tab === 'log' ? 'on' : ''} role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>Station log</button>
        </div>
        <span class="grow" />
        {v && (
          <button class="rules" title={`Rule set ${v.mode}, ${v.ruleCount} rules, hash ${v.ruleSetHash}. Click to switch.`} onClick={() => void clientRef.current?.decide({ type: 'ruleset', mode: v.mode === 'extended' ? 'base' : 'extended' })}>
            <span class={v.mode === 'extended' ? 'on' : ''}>Extended</span><span class={v.mode === 'base' ? 'on' : ''}>Base</span>
            <em class="num">{short(v.ruleSetHash)}</em>
          </button>
        )}
        <button class="iconbtn sm" title="Audit log" aria-label="Audit log" onClick={() => (auditOpen.value = true)}><Icon name="list" size={12} /></button>
        <button class="iconbtn sm" aria-label="Hide" onClick={() => (logOpen.value = false)}><Icon name="x" size={11} /></button>
      </header>
      {tab === 'agents' && v?.earlyCatch && <EarlyCatchBand />}
      <div class="rows">
        {tab === 'log' && (s.log.length === 0
          ? <div class="row"><span class="t num">--:--</span><span>Normal operation. Events appear here.</span></div>
          : s.log.slice(-40).reverse().map((l, i) => (
            <div class={`row ${l.kind}`} key={`${l.t}-${i}`} onClick={() => l.id && (selected.value = l.id)} style={{ cursor: l.id ? 'pointer' : 'default' }}>
              <span class="t num">{hhmm(l.t)}</span><span>{l.text}</span>
            </div>
          )))}
        {tab === 'agents' && entries.length === 0 && <div class="row"><span class="t num">--:--</span><span>Agents are watching. Reports appear here when something changes.</span></div>}
        {tab === 'agents' && entries.map((e) => (
          <FeedRow key={e.seq} e={e} open={open === e.seq} toggle={() => { setOpen(open === e.seq ? null : e.seq); if (e.agent !== 'COORD') onFly(e.agent); }} />
        ))}
      </div>
    </section>
  );
}

function FeedRow({ e, open, toggle }: { e: TraceEntry; open: boolean; toggle: () => void }) {
  return (
    <div class={`frow sev-${e.outcome === 'cleared' ? 'cleared' : e.severity}`}>
      <button class="fhead" onClick={toggle} aria-expanded={open}>
        <span class="t num">{hhmm(e.t)}</span>
        <i class="dot" />
        <span class="who">{e.agent === 'COORD' ? 'Coordinator' : AGENT_NAMES[e.agent]}</span>
        <span class="txt">{e.narration}</span>
      </button>
      {open && (
        <div class="trace">
          <div><b class="num">{e.ruleId}</b> v{e.version} · {e.outcome}{e.methods ? ` · ${e.methods.join(', ')}` : ''}</div>
          <div class="rule">{e.text}</div>
          {Object.keys(e.inputs).length > 0 && (
            <table><tbody>{Object.entries(e.inputs).map(([k, val]) => <tr key={k}><td>{k}</td><td class="num">{String(val)}</td></tr>)}</tbody></table>
          )}
          {e.threshold && <div class="th">Threshold <span class="num">{e.threshold.value} {e.threshold.unit}</span>: {e.threshold.label} ({e.threshold.source})</div>}
          <div class="narr"><span>Narration</span> Generated from the trace; never used to decide.</div>
        </div>
      )}
    </div>
  );
}

function EarlyCatchBand() {
  const ec = agents.value!.earlyCatch!;
  if (ec.extendedT === null) return null;
  return (
    <div class="early" role="note">
      <b>Early catch on {ec.agent}.</b>{' '}
      Extended rules reported at <span class="num">{hhmm(ec.extendedT)}</span> ({ec.extendedRule}).{' '}
      {ec.baseT !== null
        ? <>The base temperature alarm (TX-B-02) {ec.baseProjected ? 'is projected for' : 'fired at'} <span class="num">{hhmm(ec.baseT)}</span>: <b class="num">{Math.round(ec.gapMin!)} minutes</b> {ec.baseProjected ? 'later, by look-ahead' : 'later, measured'}.</>
        : <>The base rules would not alarm within six hours.</>}
    </div>
  );
}

/** A ref to the client so leaf components can send decisions. */
export const clientRef: { current: SimClient | null } = { current: null };

export function RecommendationCard() {
  const v = agents.value;
  const [modifyOf, setModifyOf] = useState<string | null>(null);
  const [mod, setMod] = useState(0);
  const [pick, setPick] = useState<string | null>(null);
  if (!v) return null;
  const rec = [...v.recommendations].reverse().find((r) => r.status === 'pending');
  const tracking = v.tracking;
  const blocked = v.blocked;
  if (!rec && !blocked && !(tracking && !tracking.note.startsWith('Complete'))) return null;
  const client = clientRef.current!;
  const decide = async (d: Parameters<SimClient['decide']>[0], label: string) => {
    const r = await client.decide(d);
    if (!r.ok) toast.value = { result: { ok: false, reason: r.reason ?? 'Refused', title: label, detail: '', deltas: [], settling: false }, key: Date.now() };
    hovered.value = null;
  };
  const chosen = rec ? rec.options.find((o) => o.id === (pick ?? rec.options[0]?.id)) : undefined;
  return (
    <aside class={`rec panel ${selected.value ? 'beside' : ''}`} aria-label="Coordinator recommendation">
      {blocked && (
        <div class="blocked">
          <b>Re-energisation blocked.</b> {blocked.reason}
          <button class="btn danger" onClick={() => (confirmReq.value = { title: `Confirm the fault on section ${blocked.section} is clear?`, body: 'Only a person who has confirmed the fault is clear on site may lift the block. This is recorded in the audit log under your name.', action: 'Confirm clear', danger: true, run: () => void decide({ type: 'confirmClear', section: blocked.section as 'A' | 'B', operator: operator.value }, 'Confirm clear') })}>Confirm fault clear</button>
        </div>
      )}
      {rec && (
        <>
          <header>
            <span class="kicker">Coordinator · {hhmm(rec.createdT)} · {rec.id}</span>
            <h3>{rec.trigger}</h3>
          </header>
          <Fan rec={rec} highlight={hovered.value?.optionId ?? chosen?.id ?? null} />
          <div class="order">Ranked by {RANK_ORDER.map((r, i) => <span key={r}>{i + 1}. {r}{i < RANK_ORDER.length - 1 ? ' ' : ''}</span>)} <em>({rec.methods.join(', ')})</em></div>
          <ol class="opts">
            {rec.options.length === 0 && <li class="none">No action improves on doing nothing over the horizon.</li>}
            {rec.options.map((o) => (
              <li key={o.id} class={o.id === chosen?.id ? 'sel' : ''}
                onMouseEnter={() => (hovered.value = { recId: rec.id, optionId: o.id })}
                onMouseLeave={() => (hovered.value = null)}
                onClick={() => setPick(o.id)}>
                <span class="rank num">{o.rank}</span>
                <span class="lbl2">{o.label}<small>{secText(o)} · peak <span class="num">{o.outcome.peakHotSpot.toFixed(0)} °C</span>{o.outcome.customerMWh > 0.05 ? <> · <span class="num">{o.outcome.customerMWh.toFixed(0)} MWh</span> unserved</> : null}{o.delayS >= 120 ? <> · full effect in <span class="num">{Math.round(o.delayS / 60)} min</span></> : null}</small></span>
                <i class={`sec ${o.outcome.security}`} title={o.outcome.security} />
              </li>
            ))}
            <li class="base"><span class="rank">-</span><span class="lbl2">Do nothing<small>{rec.baseline.security === 'holds' ? 'Holds limits' : rec.baseline.security === 'tolerable' ? 'Within emergency limits only' : 'Does not hold limits'} · peak <span class="num">{rec.baseline.peakHotSpot.toFixed(0)} °C</span></small></span></li>
          </ol>
          {chosen && modifyOf === chosen.id && chosen.magnitude && (
            <div class="modify">
              <label>{chosen.magnitude.label} <span class="num">{mod} {chosen.magnitude.unit}</span>
                <input type="range" min={chosen.magnitude.min} max={chosen.magnitude.max} step={chosen.magnitude.step} value={mod} onInput={(e) => setMod(Number((e.target as HTMLInputElement).value))} />
              </label>
              <button class="btn" onClick={() => { void decide({ type: 'modify', recId: rec.id, optionId: chosen.id, value: mod, operator: operator.value }, 'Modify'); setModifyOf(null); }}>Re-run look-ahead</button>
            </div>
          )}
          {chosen && (
            <div class="acts">
              <button class="btn primary" onClick={() => void decide({ type: 'approve', recId: rec.id, optionId: chosen.id, operator: operator.value }, 'Approve')}>Approve option {chosen.rank}</button>
              {chosen.magnitude && <button class="btn" onClick={() => { setModifyOf(chosen.id); setMod(chosen.magnitude!.value); }}>Modify</button>}
              <button class="btn" onClick={() => void decide({ type: 'reject', recId: rec.id, operator: operator.value }, 'Reject')}>Reject</button>
            </div>
          )}
          <div class="note">Hover an option to preview its predicted flows and heat in the scene. Nothing changes until a person approves. Switching programmes are always executed by a person.</div>
        </>
      )}
      {!rec && tracking && (
        <div class={`tracking ${tracking.holds ? 'ok' : 'warn'}`}><b>Tracking {tracking.recommendationId}.</b> {tracking.note}</div>
      )}
    </aside>
  );
}

const secText = (o: Option) => (o.outcome.security === 'holds' ? 'Holds every limit' : o.outcome.security === 'tolerable' ? 'Within emergency limits' : 'Does not hold limits');

/** The fan of futures: predicted hot-spot of the unit most at risk under each option, against its limits. */
function Fan({ rec, highlight }: { rec: Recommendation; highlight: string | null }) {
  const W = 340, H = 118, L = 30, B = 16;
  const txs: TransformerId[] = ['T1', 'T2', 'T3', 'T4'];
  const focusTx = txs.reduce((a, b) => (Math.max(...rec.baseline.samples.map((x) => x.hotSpot[b] * (x.loadPU[b] > 0 ? 1 : 0))) > Math.max(...rec.baseline.samples.map((x) => x.hotSpot[a] * (x.loadPU[a] > 0 ? 1 : 0))) ? b : a));
  const series = [{ id: 'none', samples: rec.baseline.samples }, ...rec.options.slice(0, 5).map((o) => ({ id: o.id, samples: o.outcome.samples }))];
  const all = series.flatMap((x) => x.samples.map((p) => p.hotSpot[focusTx]));
  const lo = Math.floor(Math.min(...all, 60) / 10) * 10;
  const hi = Math.max(130, Math.ceil(Math.max(...all) / 10) * 10);
  const x = (i: number, n: number) => L + ((W - L - 6) * i) / Math.max(1, n - 1);
  const y = (v: number) => 6 + (H - B - 6) * (1 - (v - lo) / (hi - lo));
  return (
    <svg class="fan" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Predicted ${focusTx} hot-spot under each option over ${Math.round(rec.horizonS / 60)} minutes`}>
      {[120, 140].filter((v) => v <= hi).map((v) => <g key={v}><line x1={L} x2={W - 6} y1={y(v)} y2={y(v)} class={v === 120 ? 'lim' : 'lim2'} /><text x={L - 4} y={y(v) + 3} class="ax">{v}</text></g>)}
      <text x={L - 4} y={y(lo) + 3} class="ax">{lo}</text>
      <text x={L} y={H - 3} class="ax l">now</text>
      <text x={W - 6} y={H - 3} class="ax">+{Math.round(rec.horizonS / 60)} min</text>
      <text x={W - 6} y={12} class="ax">{focusTx} hot-spot °C</text>
      {series.map((sr) => (
        <polyline key={sr.id} class={`ln ${sr.id === 'none' ? 'base' : ''} ${highlight === sr.id ? 'hi' : ''}`} points={sr.samples.map((p, i) => `${x(i, sr.samples.length).toFixed(1)},${y(p.hotSpot[focusTx]).toFixed(1)}`).join(' ')} />
      ))}
    </svg>
  );
}

export function AuditPanel() {
  const v = agents.value;
  if (!auditOpen.value || !v) return null;
  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exported: new Date().toISOString(), ruleSetHash: v.ruleSetHash, mode: v.mode, entries: v.audit }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'clonmore-audit.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div class="backdrop" role="dialog" aria-label="Audit log" onClick={(e) => e.target === e.currentTarget && (auditOpen.value = false)}>
      <div class="audit panel">
        <header>
          <h3>Audit log</h3>
          <span class="sub">Rule set {v.mode}, {v.ruleCount} rules, hash <span class="num">{v.ruleSetHash}</span></span>
          <button class="iconbtn close" aria-label="Close" onClick={() => (auditOpen.value = false)}><Icon name="x" /></button>
        </header>
        <label class="op">Operator label <input value={operator.value} onInput={(e) => (operator.value = (e.target as HTMLInputElement).value)} /></label>
        <table>
          <thead><tr><th>Sim time</th><th>Operator</th><th>Decision</th><th>Recommendation</th><th>Input hash</th></tr></thead>
          <tbody>
            {v.audit.length === 0 && <tr><td colSpan={5}>No decisions yet.</td></tr>}
            {[...v.audit].reverse().map((a) => (
              <tr key={a.seq}><td class="num">{hhmm(a.simT)}</td><td>{a.operator}</td><td>{a.decision}</td><td>{a.recommendationId} {a.option ?? ''}</td><td class="num">{short(a.inputHash)}</td></tr>
            ))}
          </tbody>
        </table>
        <div class="acts"><button class="btn" onClick={exportJson}>Export JSON</button></div>
      </div>
    </div>
  );
}
