import { useMemo, useState } from 'react';
import { useWorld } from '@/app/store';
import { useSim } from '@/sim/client';
import type { Severity, TraceEntry } from '@/agents/types';
import { ALL_TYPES, SEVERITIES, fmtHour, sevRank, typeLabel, useUi } from './uiStore';

const sevStyle: Record<Severity, string> = {
  critical: 'bg-crimson',
  warning: 'bg-amber',
  advisory: 'bg-ink-soft',
  info: 'bg-ink-faint',
};

function Entry({ t }: { t: TraceEntry }) {
  const [open, setOpen] = useState(false);
  const fly = useUi((s) => s.fly);
  const select = useUi((s) => s.set);
  const cleared = t.event === 'cleared';
  return (
    <li className="border-b hairline py-2.5">
      <button className="w-full text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="flex items-baseline gap-2.5">
          <span className="figure w-10 shrink-0 text-[11px] text-ink-soft">{fmtHour(t.step / 4)}</span>
          <span className={`mt-[3px] inline-block h-[7px] w-[7px] shrink-0 rounded-full ${cleared ? 'border hairline bg-transparent' : sevStyle[t.severity]}`} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] text-ink">{t.agentName}</span>
            <span className={`block text-[12px] leading-snug ${cleared ? 'text-ink-faint' : 'text-ink-soft'}`}>
              {cleared ? 'Cleared: ' : ''}
              {t.ruleText}
            </span>
          </span>
          <span className="figure shrink-0 text-[10px] text-ink-faint">{t.ruleId}</span>
        </div>
      </button>
      {open && (
        <div className="ml-[52px] mt-2 border-l hairline pl-3 text-[11.5px]">
          <table className="figure w-full">
            <tbody>
              <tr>
                <td className="py-0.5 pr-3 text-ink-faint">rule</td>
                <td>
                  {t.ruleId} v{t.ruleVersion} · {t.maturity} set · {t.severity}
                </td>
              </tr>
              <tr>
                <td className="py-0.5 pr-3 text-ink-faint">measured</td>
                <td>
                  {t.measure} {t.threshold.unit}
                </td>
              </tr>
              <tr>
                <td className="py-0.5 pr-3 text-ink-faint">threshold</td>
                <td>
                  {t.threshold.op} {t.threshold.value} {t.threshold.unit}{' '}
                  <span className="text-ink-faint">({t.threshold.source})</span>
                </td>
              </tr>
              {Object.entries(t.inputs).map(([k, v]) => (
                <tr key={k}>
                  <td className="py-0.5 pr-3 text-ink-faint">{k}</td>
                  <td>{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="caption mt-2 text-[13px] text-ink">{t.outcome}</p>
          {t.stale && <p className="mt-1 text-[11px] text-crimson">Inputs stale: last known values held.</p>}
          <button
            className="mt-2 text-[11px] text-ink-soft underline underline-offset-4 hover:text-ink"
            onClick={() => {
              fly(t.e, t.n, t.agentType === 'line' ? 18_000 : 6_000);
              if (t.agentType === 'line' || t.agentType === 'transformer') select({ selectedBranch: t.ref ?? null, selectedAgent: t.agentId });
              else select({ selectedAgent: t.agentId });
            }}
          >
            Show on the map
          </button>
        </div>
      )}
    </li>
  );
}

/** Right-edge drawer: the chronological agent feed up to the current time, filterable. */
export function AgentFeed() {
  const agents = useSim((s) => s.agents);
  const ui = useUi();
  // Re-render when the 15-minute interval changes, not on a timer.
  const hours = useWorld((s) => Math.min(95, Math.floor(s.hours * 4))) / 4;
  const step = Math.floor(hours * 4);
  const entries = useMemo(() => {
    if (!agents) return [] as TraceEntry[];
    return agents.trace
      .filter(
        (t) =>
          t.step <= step &&
          ui.types.has(t.agentType) &&
          sevRank[t.severity] >= sevRank[ui.minSeverity] &&
          (ui.maturity === 'extended' || t.maturity === 'base'),
      )
      .slice(-400)
      .reverse();
  }, [agents, step, ui.types, ui.minSeverity, ui.maturity]);
  const count = agents ? agents.trace.filter((t) => t.step <= step && t.event === 'fired' && sevRank[t.severity] >= 3 && (ui.maturity === 'extended' || t.maturity === 'base')).length : 0;

  return (
    <>
      <button
        className="halo absolute right-0 top-1/2 z-20 -translate-y-1/2 border-y border-l hairline px-2 py-4 text-[10px] uppercase tracking-[0.18em] text-ink [writing-mode:vertical-rl]"
        style={{ background: 'var(--panel)' }}
        onClick={() => ui.set({ feedOpen: !ui.feedOpen })}
        aria-expanded={ui.feedOpen}
      >
        Agent feed · <span className="figure">{count}</span>
      </button>
      <aside
        className={`absolute bottom-0 right-0 top-0 z-30 flex w-[420px] flex-col border-l hairline backdrop-blur-md transition-transform duration-500 ${
          ui.feedOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ background: 'var(--panel)' }}
        aria-label="Agent feed"
      >
        <header className="border-b hairline px-5 pb-3 pt-6">
          <div className="flex items-baseline justify-between">
            <h2 className="caption text-[22px] text-ink">Agent feed</h2>
            <button className="text-[11px] text-ink-soft underline underline-offset-4" onClick={() => ui.set({ feedOpen: false })}>
              close
            </button>
          </div>
          <p className="mt-1 text-[11px] text-ink-soft">
            Every entry is a rule firing or clearing, with the inputs it read. Rules are fixed and versioned; nothing here is learned at run time.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ALL_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => ui.toggleType(t)}
                className={`rounded-full border px-2.5 py-0.5 text-[10.5px] ${ui.types.has(t) ? 'border-ink text-ink' : 'hairline text-ink-faint'}`}
              >
                {typeLabel[t]}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-3 text-[10.5px] text-ink-soft">
            <span>from</span>
            {SEVERITIES.map((s) => (
              <button key={s} onClick={() => ui.set({ minSeverity: s })} className={ui.minSeverity === s ? 'text-ink underline underline-offset-4' : ''}>
                {s}
              </button>
            ))}
            <span className="ml-auto figure text-ink-faint">{ui.maturity} rules</span>
          </div>
        </header>
        <ol className="flex-1 overflow-y-auto px-5">
          {entries.map((t) => (
            <Entry key={t.seq} t={t} />
          ))}
          {!entries.length && <li className="caption py-6 text-[14px] text-ink-soft">Nothing to report at this time with these filters.</li>}
        </ol>
      </aside>
    </>
  );
}
