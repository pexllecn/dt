import { useEffect, useState } from 'react';
import { useWorld } from '@/app/store';
import { sampleSeries, useSim } from '@/sim/client';
import type { SourceLabel } from '@/lib/sourced';

interface Stat {
  label: string;
  value: string;
  unit: string;
  source: SourceLabel;
  note?: string;
}

/** Bottom-left figures, refreshed four times a second from the simulated day. */
export function StatsRow() {
  const day = useSim((s) => s.day);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);
  if (!day) return null;
  const h = useWorld.getState().hours;
  const se = day.series;
  const demand = sampleSeries(se.demand, h);
  const wind = sampleSeries(se.wind, h);
  const curtailed = sampleSeries(se.curtailed, h);
  const snsp = sampleSeries(se.snsp, h);
  const dcShare = sampleSeries(se.dcShare, h);
  const stats: Stat[] = [
    { label: 'Demand', value: (demand / 1000).toFixed(2), unit: 'GW', source: 'Synthetic', note: 'all-island, incl. losses' },
    {
      label: 'Wind',
      value: (wind / 1000).toFixed(2),
      unit: 'GW',
      source: 'Synthetic',
      note: curtailed > 1 ? `${Math.round(curtailed)} MW curtailed` : 'none curtailed',
    },
    { label: 'SNSP', value: (snsp * 100).toFixed(0), unit: '%', source: 'Synthetic', note: 'cap 75% (assumption)' },
    { label: 'Data centre share', value: (dcShare * 100).toFixed(0), unit: '%', source: 'Synthetic', note: 'of ROI demand now' },
  ];
  return (
    <div className="halo pointer-events-none absolute bottom-[104px] left-8 flex select-none items-end">
      {stats.map((s, i) => (
        <div key={s.label} className={`pr-7 ${i > 0 ? 'border-l hairline pl-7' : ''}`}>
          <p className="text-[10px] uppercase tracking-[0.16em] text-ink-soft">{s.label}</p>
          <p className="mt-1 leading-none text-ink">
            <span className="figure text-[34px] font-normal tracking-[-0.02em]">{s.value}</span>
            <span className="figure ml-1.5 text-[12px] text-ink-soft">{s.unit}</span>
          </p>
          <p className="mt-1.5 text-[10px] text-ink-faint">
            {s.note} · <span className="uppercase tracking-[0.1em]">{s.source}</span>
          </p>
        </div>
      ))}
    </div>
  );
}
