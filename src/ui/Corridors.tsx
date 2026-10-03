import { useEffect, useMemo, useRef } from 'react';
import { project } from '@/app/bridge';
import { useSim } from '@/sim/client';
import { SourceTag } from './SourceTag';
import { useUi } from './uiStore';

function useCorridors() {
  const corridors = useSim((s) => s.corridors);
  const inputs = useSim((s) => s.inputs);
  const show = inputs.scenario === 'y2034' && (inputs.year ?? 2034) >= 2034;
  return useMemo(() => (show && corridors ? corridors : []), [show, corridors]);
}

/** 2034: the five most constrained corridors, ranked by energy above rating after a single fault. */
export function CorridorsPanel() {
  const list = useCorridors();
  const ui = useUi();
  const dcShare = useSim((s) => (s.day ? Math.max(...s.day.series.dcShare) : 0));
  if (!list.length) return null;
  return (
    <section
      className="absolute left-8 top-[124px] z-20 w-[380px] border hairline px-5 pb-4 pt-4 backdrop-blur-md"
      style={{ background: 'var(--panel)' }}
      aria-label="Top five constrained corridors"
    >
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] text-ink-soft">2034 · top five constrained corridors</p>
        <SourceTag s="Synthetic" />
      </div>
      <p className="mt-1 text-[11px] leading-snug text-ink-soft">
        Data centre share {Math.round(dcShare * 100)}% of demand. Ranked by the strain growth adds since 2026: energy above rating over the day, after any single fault, with overloads with nothing out counted double.
      </p>
      <ol className="mt-2">
        {list.map((c) => {
          const sel = !!ui.selectedBranch && c.branches.includes(ui.selectedBranch);
          return (
            <li key={c.branch} className="border-t hairline py-1.5">
              <button
                className="grid w-full grid-cols-[22px_1fr_auto] items-baseline gap-x-2 text-left"
                onClick={() => {
                  ui.fly(c.e, c.n, c.kv >= 220 ? 34_000 : 20_000);
                  ui.set({ selectedBranch: c.branch, selectedAgent: null });
                }}
              >
                <span className={`figure text-[15px] ${sel ? 'text-crimson' : 'text-ink'}`}>{c.rank}</span>
                <span className="text-[12px] leading-snug text-ink">{c.label}</span>
                <span className="figure text-[11px] text-crimson">{Math.round(Math.max(c.peakN1, c.peakIntact) * 100)}%</span>
                <span />
                <span className="figure col-span-2 text-[10.5px] text-ink-faint">
                  {c.hoursN1.toFixed(1)} h above rating after a fault{c.hoursIntact ? ` · ${c.hoursIntact.toFixed(1)} h with nothing out` : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Numbered labels on the map at each corridor. */
export function CorridorLabels() {
  const list = useCorridors();
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      list.forEach((c, i) => {
        const el = refs.current[i];
        if (!el) return;
        const p = project(c.e, c.n, 120, window.innerWidth, window.innerHeight);
        el.style.opacity = p ? '1' : '0';
        if (p) el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
      });
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [list]);
  if (!list.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      {list.map((c, i) => (
        <div key={c.branch} ref={(el) => void (refs.current[i] = el)} className="absolute left-0 top-0 opacity-0" style={{ transition: 'opacity 400ms' }}>
          <div className="-translate-x-1/2 -translate-y-1/2">
            <span className="figure flex h-6 w-6 items-center justify-center rounded-full border border-crimson text-[12px] text-crimson" style={{ background: 'var(--panel)' }}>
              {c.rank}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
