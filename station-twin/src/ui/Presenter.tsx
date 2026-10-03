/**
 * Presenter-facing parts of the interface: the guided tour caption, the command palette, the
 * supply and demand Sankey, and the timeline with its event markers.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SITE } from '../config/assumptions.ts';
import { clockLabel } from '../lib/format.ts';
import type { SimClient } from '../app/client.ts';
import { agents, lens, paletteOpen, sankeyOpen, selected, snap, theme, toast, tour } from '../app/store.ts';
import { AGENT_NAMES } from '../agents/agents.ts';
import { SCENARIOS } from '../sim/scenarios.ts';
import type { ComponentId } from '../sim/types.ts';
import { Icon } from './icons.tsx';

const hhmm = (t: number) => clockLabel(SITE.epochUtcMs.value, t).slice(-5);

// --- guided tour -------------------------------------------------------------------------------------
export function TourCaption({ client }: { client: SimClient }) {
  const t = tour.value;
  if (!t) return null;
  return (
    <section class="tourcap panel" aria-live="polite" aria-label="Guided tour">
      <div class="tc-top">
        <span class="num">{t.beat + 1} / {t.count}</span>
        <b>{t.title}</b>
        <span class="grow" />
        <button class="btn sm" onClick={() => client.tour('prev')} disabled={t.beat === 0} aria-label="Previous beat">Back</button>
        <button class="btn sm primary" onClick={() => client.tour('next')} aria-label="Next">{t.awaiting === 'approve' ? 'Approve' : 'Next'}</button>
        <button class="iconbtn sm" aria-label="End tour" onClick={() => client.tour('stop')}><Icon name="x" size={11} /></button>
      </div>
      <p>{t.caption}</p>
      {t.summary && (
        <p class="sum">Agents raised <b class="num">{t.summary.alerts}</b> alerts, the coordinator made <b class="num">{t.summary.recommendations}</b> recommendations, and <b class="num">{t.summary.approved}</b> were approved by a person. Every one is in the audit log.</p>
      )}
      <div class={`tc-next ${t.awaiting === 'approve' ? 'approve' : ''}`}><kbd>→</kbd> {t.nextAction} <span class="dim">· <kbd>←</kbd> back</span></div>
    </section>
  );
}

// --- command palette ---------------------------------------------------------------------------------------
interface Item { kind: 'Asset' | 'Scenario' | 'Lens' | 'Action'; label: string; detail: string; run: () => void }

export function CommandPalette({ client, onFly }: { client: SimClient; onFly: (id: ComponentId) => void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (paletteOpen.value) { setQ(''); setI(0); setTimeout(() => input.current?.focus(), 0); } }, [paletteOpen.value]);
  const items = useMemo<Item[]>(() => {
    const s = snap.value;
    const out: Item[] = [];
    if (s) for (const id of Object.keys(s.C) as ComponentId[]) out.push({ kind: 'Asset', label: AGENT_NAMES[id] ?? id, detail: s.C[id].name, run: () => { selected.value = id; onFly(id); } });
    for (const sc of SCENARIOS) out.push({ kind: 'Scenario', label: sc.title, detail: sc.description, run: () => void client.command({ type: 'scenario', id: sc.id }).then((r) => (toast.value = { result: r, key: Date.now() })) });
    out.push({ kind: 'Lens', label: 'Physical lens', detail: 'Key 1', run: () => (lens.value = 'physical') });
    out.push({ kind: 'Lens', label: 'Flow lens', detail: 'Key 2', run: () => (lens.value = 'flow') });
    out.push({ kind: 'Lens', label: 'Circuit lens', detail: 'Key 3', run: () => (lens.value = 'circuit') });
    out.push({ kind: 'Action', label: 'Start the guided tour', detail: 'Right arrow', run: () => client.tour('start') });
    out.push({ kind: 'Action', label: 'Supply and demand', detail: 'Sankey of sources and sinks', run: () => (sankeyOpen.value = true) });
    out.push({ kind: 'Action', label: 'Switch theme', detail: 'Key T', run: () => (theme.value = theme.value === 'daylight' ? 'control' : 'daylight') });
    return out;
  }, [snap.value === null, paletteOpen.value]);
  if (!paletteOpen.value) return null;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = items.filter((it) => words.every((w) => `${it.label} ${it.detail} ${it.kind}`.toLowerCase().includes(w))).slice(0, 9);
  const go = (it: Item | undefined) => { if (!it) return; paletteOpen.value = false; it.run(); };
  return (
    <div class="backdrop" onClick={(e) => e.target === e.currentTarget && (paletteOpen.value = false)}>
      <div class="palette panel" role="dialog" aria-label="Command palette">
        <input ref={input} value={q} placeholder="Jump to an asset or run a scenario" aria-label="Search"
          onInput={(e) => { setQ((e.target as HTMLInputElement).value); setI(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(shown.length - 1, i + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(0, i - 1)); }
            if (e.key === 'Enter') go(shown[i]);
            if (e.key === 'Escape') paletteOpen.value = false;
          }} />
        <ul>
          {shown.map((it, k) => (
            <li key={`${it.kind}-${it.label}`} class={k === i ? 'on' : ''} onMouseEnter={() => setI(k)} onClick={() => go(it)}>
              <span class="kind">{it.kind}</span><span>{it.label}</span><span class="detail">{it.detail}</span>
            </li>
          ))}
          {shown.length === 0 && <li class="none">Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}

// --- Sankey ------------------------------------------------------------------------------------------------
const COLOURS: Record<string, string> = {
  grid_import: 'var(--energised)', wind: 'var(--renewable)', solar: 'var(--renewable)', battery_dis: 'var(--storage)', gas: 'var(--thermal-plant)', nbr_in: 'var(--info)',
  regional: 'var(--ink-2)', new_conn: 'var(--ink-2)', industrial: 'var(--ink-2)', border: 'var(--info)', battery_chg: 'var(--storage)', grid_export: 'var(--energised)', nbr_out: 'var(--info)',
};

export function Sankey() {
  const s = snap.value;
  if (!sankeyOpen.value || !s) return null;
  const sup = s.results.parts.sup.filter((p) => p.mw > 0.5);
  const dem = s.results.parts.dem.filter((p) => p.mw > 0.5);
  const total = Math.max(1, sup.reduce((a, p) => a + p.mw, 0), dem.reduce((a, p) => a + p.mw, 0));
  const W = 640, H = 300, nodeW = 10, gap = 8, x0 = 150, x1 = W - 160, mid = (x0 + x1) / 2;
  const scale = (H - gap * Math.max(sup.length, dem.length)) / total;
  const stack = (parts: typeof sup) => { let y = 4; return parts.map((p) => { const h = Math.max(2, p.mw * scale); const r = { p, y, h }; y += h + gap; return r; }); };
  const L = stack(sup), R = stack(dem);
  const midTop = (H - total * scale) / 2;
  let ml = midTop, mr = midTop;
  const ribbon = (xa: number, ya: number, xb: number, yb: number, h: number) => `M${xa},${ya} C${(xa + xb) / 2},${ya} ${(xa + xb) / 2},${yb} ${xb},${yb} L${xb},${yb + h} C${(xa + xb) / 2},${yb + h} ${(xa + xb) / 2},${ya + h} ${xa},${ya + h} Z`;
  return (
    <div class="backdrop" onClick={(e) => e.target === e.currentTarget && (sankeyOpen.value = false)}>
      <div class="sankey panel" role="dialog" aria-label="Supply and demand">
        <header><h3>Supply and demand, {hhmm(s.t)}</h3><span class="sub">Sources into Clonmore's busbars, and where the power goes. Local renewable share {s.results.renewPct.toFixed(0)}%.</span>
          <button class="iconbtn close" aria-label="Close" onClick={() => (sankeyOpen.value = false)}><Icon name="x" /></button></header>
        <svg viewBox={`0 0 ${W} ${H + 10}`} class="sk" role="img" aria-label="Sankey diagram of supply and demand">
          {L.map(({ p, y, h }) => { const d = ribbon(x0 + nodeW, y, mid - 6, ml, h); ml += h; return <path key={p.key} d={d} style={{ fill: COLOURS[p.key] }} class="rb" />; })}
          {R.map(({ p, y, h }) => { const d = ribbon(mid + 6, mr, x1, y, h); mr += h; return <path key={p.key} d={d} style={{ fill: COLOURS[p.key] }} class="rb" />; })}
          <rect x={mid - 6} y={midTop} width={12} height={total * scale} class="node" />
          <text x={mid} y={midTop - 6} class="lab c">Busbars</text>
          {L.map(({ p, y, h }) => <g key={p.key}><rect x={x0} y={y} width={nodeW} height={h} style={{ fill: COLOURS[p.key] }} /><text x={x0 - 6} y={y + h / 2 + 4} class="lab r">{p.label} <tspan class="num">{p.mw.toFixed(0)} MW</tspan></text></g>)}
          {R.map(({ p, y, h }) => <g key={p.key}><rect x={x1} y={y} width={nodeW} height={h} style={{ fill: COLOURS[p.key] }} /><text x={x1 + nodeW + 6} y={y + h / 2 + 4} class="lab">{p.label} <tspan class="num">{p.mw.toFixed(0)} MW</tspan></text></g>)}
        </svg>
        <div class="bars" aria-hidden="true">
          {[['Supply', sup], ['Demand', dem]].map(([name, parts]) => (
            <div key={name as string} class="bar"><span>{name as string}</span><div>{(parts as typeof sup).map((p) => <i key={p.key} title={`${p.label} ${p.mw.toFixed(0)} MW`} style={{ width: `${(p.mw / total) * 100}%`, background: COLOURS[p.key] }} />)}</div></div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- timeline ------------------------------------------------------------------------------------------------
export function Timeline({ client, onFly }: { client: SimClient; onFly: (id: ComponentId) => void }) {
  const s = snap.value;
  const v = agents.value;
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (!s) return null;
  const day0 = Math.floor(s.t / 86400) * 86400;
  const frac = (t: number) => Math.min(1, Math.max(0, (t - day0) / 86400));
  const marks: { t: number; cls: string; text: string; id: ComponentId | null }[] = [];
  for (const l of s.log) if (l.t >= day0 && (l.kind === 'protection' || l.kind === 'trip' || l.kind === 'alarm')) marks.push({ t: l.t, cls: l.kind === 'alarm' ? 'warn' : 'fault', text: l.text, id: l.id });
  if (v) {
    for (const e of v.feed) if (e.t >= day0 && e.outcome === 'fired' && (e.severity === 'warning' || e.severity === 'critical') && e.agent !== 'COORD') marks.push({ t: e.t, cls: 'agent', text: `${AGENT_NAMES[e.agent]}: ${e.text}`, id: e.agent });
    for (const a of v.audit) if (a.simT >= day0) marks.push({ t: a.simT, cls: 'decision', text: `${a.operator}: ${a.decision} ${a.option ?? ''}`, id: null });
  }
  const timeAt = (clientX: number) => { const r = bar.current!.getBoundingClientRect(); return day0 + Math.round((((clientX - r.left) / r.width) * 86400) / 300) * 300; };
  const scrub = (clientX: number) => {
    const t = timeAt(clientX);
    if (t > s.t + 60) void client.command({ type: 'fastForward', to: t });
    else if (t < s.t - 60) void client.decide({ type: 'rewind', t });
  };
  return (
    <div class="timeline panel" aria-label="Timeline">
      <div class="tl-bar" ref={bar} onClick={(e) => scrub(e.clientX)} onMouseMove={(e) => setHover(timeAt(e.clientX))} onMouseLeave={() => setHover(null)}>
        {[0, 6, 12, 18].map((h) => <span key={h} class="tick" style={{ left: `${(h / 24) * 100}%` }}><em class="num">{String(h).padStart(2, '0')}:00</em></span>)}
        <span class="past" style={{ width: `${frac(s.t) * 100}%` }} />
        {marks.slice(-80).map((m, k) => (
          <button key={k} class={`mk ${m.cls}`} style={{ left: `${frac(m.t) * 100}%` }} title={`${hhmm(m.t)} ${m.text}`} aria-label={`${hhmm(m.t)} ${m.text}`}
            onClick={(e) => { e.stopPropagation(); if (m.id) { selected.value = m.id; onFly(m.id); } }} />
        ))}
        <span class="now" style={{ left: `${frac(s.t) * 100}%` }} />
        {hover !== null && <span class="hov num" style={{ left: `${frac(hover) * 100}%` }}>{hhmm(hover)}</span>}
      </div>
    </div>
  );
}
