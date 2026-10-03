import { useEffect, useMemo, useRef } from 'react';
import { project } from '@/app/bridge';
import { useWorld } from '@/app/store';
import { REGION_W } from '@/agents/engine';
import { useSim } from '@/sim/client';
import { useUi } from './uiStore';

const MAX = 80;

/**
 * Agent glyphs: a small mark at each asset whose agent is at warning or above at the current
 * time, so attention follows the map. Positions are projected every frame without re-rendering.
 */
export function Glyphs() {
  const meta = useSim((s) => s.meta);
  const agents = useSim((s) => s.agents);
  const inputs = useSim((s) => s.inputs);
  const maturity = useUi((s) => s.maturity);
  const selectedAgent = useUi((s) => s.selectedAgent);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  // Re-render when the 15-minute interval changes, not on a timer.
  const hours = useWorld((s) => Math.min(95, Math.floor(s.hours * 4))) / 4;
  const step = Math.min(95, Math.floor(hours * 4));
  const stale = inputs.commsLostFromHour !== null && hours >= inputs.commsLostFromHour;

  const shown = useMemo(() => {
    if (!meta || !agents) return [];
    const nA = meta.agents.length;
    const lv = maturity === 'base' ? agents.levelBase : agents.level;
    const list: { idx: number; level: number }[] = [];
    for (let a = 0; a < nA; a++) {
      const l = lv[step * nA + a]!;
      if (l >= 3 && meta.agents[a]!.type !== 'coordinator') list.push({ idx: a, level: l });
    }
    list.sort((a, b) => b.level - a.level);
    const out = list.slice(0, MAX);
    if (selectedAgent && !out.some((g) => meta.agents[g.idx]!.id === selectedAgent)) {
      const idx = meta.agents.findIndex((a) => a.id === selectedAgent);
      if (idx >= 0) out.push({ idx, level: lv[step * nA + idx]! });
    }
    return out.map((g) => ({ ...g, info: meta.agents[g.idx]!, stale: stale && REGION_W.includes(meta.agents[g.idx]!.county) }));
  }, [meta, agents, maturity, step, selectedAgent, stale]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (const g of shown) {
        const el = refs.current.get(g.info.id);
        if (!el) continue;
        const p = project(g.info.e, g.info.n, 60, w, h);
        if (!p) {
          el.style.opacity = '0';
          continue;
        }
        el.style.opacity = '1';
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      }
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [shown]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden={shown.length === 0}>
      {shown.map((g) => {
        const crit = g.level >= 4;
        const sel = g.info.id === selectedAgent;
        return (
          <button
            key={g.info.id}
            ref={(el) => {
              if (el) refs.current.set(g.info.id, el);
              else refs.current.delete(g.info.id);
            }}
            title={`${g.info.name}${g.stale ? ' (data stale)' : ''}`}
            aria-label={`${g.info.name}, ${crit ? 'critical' : 'warning'}`}
            className="pointer-events-auto absolute left-0 top-0 opacity-0"
            style={{ transition: 'opacity 300ms' }}
            onClick={() => {
              const ui = useUi.getState();
              ui.set({ selectedAgent: g.info.id, selectedBranch: g.info.type === 'line' || g.info.type === 'transformer' ? g.info.ref : null });
            }}
          >
            <span className="absolute -translate-x-1/2 -translate-y-1/2">
              {crit && <span className="breathe absolute -inset-[7px] rounded-full border border-crimson" />}
              <span
                className={`block h-[9px] w-[9px] rotate-45 border ${g.stale ? 'border-dashed bg-transparent' : ''} ${crit ? 'border-crimson' : 'border-amber'}`}
                style={{ background: g.stale ? 'transparent' : crit ? 'var(--crimson)' : 'var(--amber)', outline: sel ? '1px solid var(--ink)' : undefined, outlineOffset: 3 }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}
