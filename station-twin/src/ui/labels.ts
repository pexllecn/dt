/**
 * Labels over the 3D scene: DOM elements projected from component anchors every frame, with
 * priority-based decluttering. Updated imperatively so the UI framework never runs per frame.
 */
import type { Stage } from '../scene/stage.ts';
import type { ComponentId, SimState } from '../sim/types.ts';

const PRIORITY: ComponentId[] = ['T1', 'T2', 'GRID', 'LD_TOWN', 'WIND', 'T3', 'T4', 'TIE_NI', 'TIE_N', 'SOLAR', 'GAS', 'BESS', 'LD_NEW', 'LD_IND', 'TIE_S', 'BS220', 'BUS400', 'BUS220A', 'BUS220B', 'BUS110'];
const SHORT: Partial<Record<ComponentId, string>> = {
  GRID: '400 kV infeed', LD_TOWN: 'Regional demand', WIND: 'Wind farm', SOLAR: 'Solar farm', GAS: 'Gas peaker', BESS: 'Battery',
  LD_NEW: 'New connection', LD_IND: 'Industrial park', TIE_NI: 'Border 275 kV', TIE_N: 'Ardnagreany', TIE_S: 'Ballyduff', BS220: 'Bus section',
  BUS400: '400 kV busbar', BUS220A: '220 kV section A', BUS220B: '220 kV section B', BUS110: '110 kV busbar',
};

function text(id: ComponentId, s: SimState): { name: string; value: string; cls: string } {
  const c = s.C[id];
  const name = SHORT[id] ?? id;
  if (!c.installed) return { name, value: 'not built', cls: 'dead' };
  if (c.tripped) return { name, value: 'tripped', cls: 'trip' };
  if (c.kind === 'tx') return { name, value: `${(c.loadPU * 100).toFixed(0)}% · ${c.temp.toFixed(0)} °C`, cls: c.live ? '' : 'dead' };
  if (c.kind === 'grid') return { name, value: `${Math.abs(s.results.gridFlow).toFixed(0)} MW ${s.results.gridFlow >= 0 ? 'in' : 'out'}`, cls: c.live ? '' : 'dead' };
  if (c.kind === 'bess') return { name, value: `${c.mwNow.toFixed(0)} MW · ${c.soc.toFixed(0)}%`, cls: c.live ? '' : 'dead' };
  if (c.kind === 'bus' || c.kind === 'bussection') return { name, value: c.live ? 'energised' : 'dead', cls: c.live ? '' : 'dead' };
  if (!c.closed) return { name, value: 'open', cls: 'dead' };
  return { name, value: `${Math.abs(c.mwNow).toFixed(0)} MW`, cls: c.live ? '' : 'dead' };
}

const ARROW = '<svg viewBox="0 0 10 10"><path d="M1 5h7M5 1.8 8.3 5 5 8.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function attachLabels(stage: Stage, layer: HTMLElement, getState: () => SimState | null, getSelected: () => ComponentId | null, onClick: (id: ComponentId) => void): () => void {
  const els = new Map<ComponentId, HTMLElement>();
  for (const id of PRIORITY) {
    const el = document.createElement('div');
    el.className = 'lbl';
    el.style.opacity = '0';
    el.addEventListener('click', () => onClick(id));
    layer.appendChild(el);
    els.set(id, el);
  }
  const cache = new Map<ComponentId, string>();
  // Static place labels (neighbour stations, the border), shown only at network scale.
  const statics = stage.surroundings.staticLabels.map((l) => {
    const el = document.createElement('div');
    el.className = 'lbl place';
    el.style.opacity = '0';
    el.textContent = l.text;
    layer.appendChild(el);
    return { ...l, el };
  });
  return () => {
    const s = getState();
    if (!s) return;
    const far = stage.isNetworkScale();
    const sel = getSelected();
    const projected = stage.project(PRIORITY);
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const sel2 of ['.top', '.dock:not(.closed)', '.insp', '.log', '.badge', '.toast']) {
      const el = document.querySelector(sel2);
      if (el) { const r = el.getBoundingClientRect(); placed.push({ x0: r.left, x1: r.right, y0: r.top, y1: r.bottom }); }
    }
    for (const p of projected) {
      const el = els.get(p.id)!;
      const isBus = p.id.startsWith('BUS') || p.id === 'BS220';
      const circ = stage.foldP() > 0.5;
      const maxDist = circ ? Infinity : far ? (isBus || p.id === 'BS220' ? 0 : 12000) : isBus ? 260 : p.id === 'T1' || p.id === 'T2' || p.id === 'GRID' || p.id === 'LD_TOWN' ? 1600 : 700;
      let show = p.visible && (p.distance < maxDist || p.id === sel);
      if (!circ && far && (p.id === 'T1' || p.id === 'T2' || p.id === 'T3' || p.id === 'T4' || !s.C[p.id].installed) && p.id !== sel) show = false;
      const w = circ ? 118 : 150;
      const box = { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - 26, y1: p.y };
      if (show && placed.some((b) => b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0)) show = false;
      if (show) placed.push(box);
      el.style.opacity = show ? '1' : '0';
      el.style.pointerEvents = show ? 'auto' : 'none';
      if (!show) continue;
      el.style.left = `${p.x.toFixed(1)}px`;
      el.style.top = `${p.y.toFixed(1)}px`;
      const t = text(p.id, s);
      // Flow lens: an arrow turned to the on-screen direction of flow (snapped to 5 degrees so it does not churn).
      const ang = stage.lens === 'flow' ? stage.flowArrow(p.id, p) : null;
      const arrow = ang === null ? '' : `<i class="arr" style="transform:rotate(${Math.round((ang * 180) / Math.PI / 5) * 5}deg)">${ARROW}</i>`;
      const html = `${arrow}<b>${t.name}</b><span class="num">${t.value}</span>`;
      const cls = `lbl ${t.cls} ${p.id === sel ? 'sel' : ''} ${circ ? 'circ' : ''}`;
      if (cache.get(p.id) !== html + cls) { el.innerHTML = html; el.className = cls; cache.set(p.id, html + cls); }
    }
    for (const l of statics) {
      const p = stage.projectPoint(l.pos);
      let show = p.visible && p.distance > l.minDistance && stage.foldP() === 0;
      const w = l.text.length * 7 + 16;
      const box = { x0: p.x - w / 2, x1: p.x + w / 2, y0: p.y - 22, y1: p.y };
      if (show && placed.some((b) => b.x0 < box.x1 && b.x1 > box.x0 && b.y0 < box.y1 && b.y1 > box.y0)) show = false;
      if (show) placed.push(box);
      l.el.style.opacity = show ? '1' : '0';
      if (show) { l.el.style.left = `${p.x.toFixed(1)}px`; l.el.style.top = `${p.y.toFixed(1)}px`; }
    }
  };
}
