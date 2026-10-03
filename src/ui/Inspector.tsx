import { useWorld } from '@/app/store';
import { useSim } from '@/sim/client';
import { SourceTag } from './SourceTag';
import { fmtHour, sevRank, useUi } from './uiStore';
import { useTick } from './useTick';

const W = 278;
const H = 74;

/** Day-long sparkline of intact and N-1 loading for one branch, with the 100% line and a time cursor. */
function Sparkline({ intact, n1, hours }: { intact: number[]; n1: number[]; hours: number }) {
  const max = Math.max(1.2, ...n1, ...intact);
  const y = (v: number) => H - (v / max) * (H - 6) - 3;
  const path = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${((i / (arr.length - 1)) * W).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const x = (hours / 24) * W;
  return (
    <svg width={W} height={H} className="mt-2 block overflow-visible" aria-label="Loading over the day">
      <line x1={0} x2={W} y1={y(1)} y2={y(1)} stroke="var(--crimson)" strokeWidth={0.75} strokeDasharray="3 3" />
      <text x={W} y={y(1) - 3} textAnchor="end" className="figure" fontSize={9} fill="var(--crimson)">
        100%
      </text>
      <path d={path(n1)} fill="none" stroke="var(--amber)" strokeWidth={1} strokeDasharray="2 2" />
      <path d={path(intact)} fill="none" stroke="var(--ink)" strokeWidth={1.4} />
      <line x1={x} x2={x} y1={0} y2={H} stroke="var(--ink-soft)" strokeWidth={0.75} />
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} x={(h / 24) * W} y={H + 11} textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'} className="figure" fontSize={9} fill="var(--ink-faint)">
          {String(h).padStart(2, '0')}
        </text>
      ))}
    </svg>
  );
}

/** Asset inspector for the selected line, cable or transformer. */
export function Inspector() {
  useTick(300);
  const ui = useUi();
  const meta = useSim((s) => s.meta);
  const day = useSim((s) => s.day);
  const agents = useSim((s) => s.agents);
  const inputs = useSim((s) => s.inputs);
  const trip = useSim((s) => s.trip);
  const restore = useSim((s) => s.restore);
  if (!ui.selectedBranch || !meta || !day) return null;
  const i = meta.branches.findIndex((b) => b.id === ui.selectedBranch);
  if (i < 0) return null;
  const b = meta.branches[i]!;
  const nb = meta.branches.length;
  const hours = useWorld.getState().hours;
  const s = Math.min(95, Math.floor(hours * 4));
  const intact = Array.from({ length: 96 }, (_, k) => day.loading[k * nb + i]!);
  const n1 = Array.from({ length: 96 }, (_, k) => day.n1Loading[k * nb + i]!);
  const flow = day.flows[s * nb + i]!;
  const load = intact[s]!;
  const n1Now = n1[s]!;
  const cause = meta.contingencyLabels[day.n1Cause[s * nb + i]!];
  let rating = 0;
  for (let k = 0; k < 96; k++) if (intact[k]! > 0.05) rating = Math.max(rating, Math.abs(day.flows[k * nb + i]!) / intact[k]!);
  const out = inputs.outages.includes(b.id) || inputs.timedOutages.some((t) => t.id === b.id && hours >= t.fromHour);
  const watchers = meta.agents.map((a, idx) => ({ a, idx })).filter(({ a }) => a.ref === b.id);
  const levelArr = agents ? (ui.maturity === 'base' ? agents.levelBase : agents.level) : null;
  const nA = meta.agents.length;
  const recent = agents
    ? agents.trace
        .filter((t) => t.ref === b.id && t.step <= s && (ui.maturity === 'extended' || t.maturity === 'base') && t.event === 'fired')
        .slice(-4)
        .reverse()
    : [];
  const kind = b.kind === 'transformer' ? 'transformer' : b.kind === 'cable' ? 'underground cable' : 'overhead line';
  const lvlName = ['clear', 'info', 'advisory', 'warning', 'critical'];

  return (
    <section
      className="absolute top-24 z-20 max-h-[calc(100%-260px)] w-[320px] overflow-y-auto border hairline px-5 pb-4 pt-4 backdrop-blur-md transition-[right] duration-500"
      style={{ background: 'var(--panel)', right: ui.feedOpen ? 448 : 32, maxHeight: ui.narrationOn ? 'calc(100% - 460px)' : undefined }}
      aria-label="Asset inspector"
    >
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] text-ink-soft">Asset</p>
        <button className="text-[11px] text-ink-soft underline underline-offset-4" onClick={() => ui.set({ selectedBranch: null, selectedAgent: null })}>
          close
        </button>
      </div>
      <h3 className="caption mt-1 text-[21px] leading-tight text-ink">{b.label}</h3>
      <p className="mt-1 text-[11.5px] text-ink-soft">
        {b.kv} kV {kind}
        {b.kind !== 'transformer' && ` · ${b.lengthKm.toFixed(1)} km`} · {b.circuits} {b.kind === 'transformer' ? (b.circuits === 1 ? 'unit' : 'units') : b.circuits === 1 ? 'circuit' : 'circuits'}
        {b.country === 'NI' && ' · Northern Ireland (simulated)'}
      </p>
      <p className="mt-0.5 text-[10px] text-ink-faint">
        route <SourceTag s="Public" /> OpenStreetMap · rating <SourceTag s="Assumption" /> {Math.round(rating)} MW
      </p>

      {out ? (
        <p className="caption mt-3 text-[15px] text-crimson">Out of service</p>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div>
            <p className="text-[10px] text-ink-faint">flow</p>
            <p className="figure text-[17px] text-ink">{Math.abs(Math.round(flow))} MW</p>
          </div>
          <div>
            <p className="text-[10px] text-ink-faint">loading</p>
            <p className={`figure text-[17px] ${load > 0.9 ? 'text-crimson' : load > 0.6 ? 'text-amber' : 'text-ink'}`}>{Math.round(load * 100)}%</p>
          </div>
          <div>
            <p className="text-[10px] text-ink-faint">worst N-1</p>
            <p className={`figure text-[17px] ${n1Now > 1 ? 'text-crimson' : 'text-ink'}`}>{Math.round(n1Now * 100)}%</p>
          </div>
        </div>
      )}
      {!out && n1Now > 0.8 && cause && <p className="mt-1 text-[10.5px] text-ink-soft">Worst case: {cause}</p>}
      <Sparkline intact={intact} n1={n1} hours={hours} />
      <p className="mt-4 flex gap-4 text-[10px] text-ink-faint">
        <span>
          <span className="mr-1 inline-block h-px w-4 bg-ink align-middle" /> intact
        </span>
        <span>
          <span className="mr-1 inline-block w-4 border-t border-dashed border-amber align-middle" /> worst single outage
        </span>
        <span className="ml-auto">
          <SourceTag s="Synthetic" />
        </span>
      </p>

      {watchers.length > 0 && (
        <div className="mt-3 border-t hairline pt-2.5">
          {watchers.map(({ a, idx }) => {
            const lv = levelArr ? levelArr[s * nA + idx]! : 0;
            return (
              <p key={a.id} className="flex justify-between text-[11.5px]">
                <span className="text-ink">{a.name}</span>
                <span className={`figure ${lv >= 4 ? 'text-crimson' : lv >= 3 ? 'text-amber' : 'text-ink-soft'}`}>{lvlName[lv]}</span>
              </p>
            );
          })}
          {recent.map((t) => (
            <p key={t.seq} className="mt-1 text-[11px] leading-snug text-ink-soft">
              <span className="figure text-ink-faint">{fmtHour(t.step / 4)}</span> <span className={sevRank[t.severity] >= 4 ? 'text-crimson' : ''}>{t.ruleId}</span> {t.ruleText}
            </p>
          ))}
        </div>
      )}

      <div className="mt-3 flex gap-4 border-t hairline pt-2.5 text-[11.5px]">
        {inputs.outages.includes(b.id) ? (
          <button className="text-ink underline underline-offset-4" onClick={() => restore(b.id)}>
            Restore
          </button>
        ) : (
          <button className="text-crimson underline underline-offset-4" onClick={() => trip(b.id)}>
            Cut (take out of service)
          </button>
        )}
        <button className="text-ink-soft underline underline-offset-4" onClick={() => ui.set({ feedOpen: true })}>
          Agent feed
        </button>
      </div>
    </section>
  );
}
