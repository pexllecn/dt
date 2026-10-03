import { useWorld } from '@/app/store';
import { useSim } from '@/sim/client';
import { scenarios, type ScenarioId } from '@/sim/scenarios';
import { fmtHour, useUi } from './uiStore';
import { SourceTag } from './SourceTag';
import { useDirector } from '@/director/store';

const swatch: Record<ScenarioId, string> = { today: '#c9c3b5', hero: '#a8231b', storm: '#4f5d6b', y2034: '#a86a12' };

function Slider(props: { label: string; left: string; right: string; min: number; max: number; step: number; value: number; onChange(v: number): void; readout: string }) {
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.16em] text-ink-soft">
        <span>{props.label}</span>
        <span className="figure normal-case tracking-normal text-ink">{props.readout}</span>
      </div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="specimen-range mt-1.5 w-full"
        aria-label={props.label}
      />
      <div className="caption flex justify-between text-[12px] text-ink-soft">
        <span>{props.left}</span>
        <span>{props.right}</span>
      </div>
    </div>
  );
}

/** Right panel: scenario swatches and sliders, each bound to a real model input. */
export function SpecimenPanel() {
  const inputs = useSim((s) => s.inputs);
  const setInputs = useSim((s) => s.setInputs);
  const applyScenario = useSim((s) => s.applyScenario);
  const day = useSim((s) => s.day);
  const meta = useSim((s) => s.meta);
  const ui = useUi();
  const sc = scenarios[inputs.scenario];
  const year = inputs.year ?? sc.year;
  const ic = inputs.icShare ?? sc.icShare;
  // Re-render when the 15-minute interval changes, not on a timer.
  const hours = useWorld((s) => Math.min(95, Math.floor(s.hours * 4))) / 4;
  const mode = useDirector((s) => s.mode);
  if (ui.selectedBranch || mode === 'director') return null;

  const sweep = () => {
    if (!day || !meta) return;
    const nb = meta.branches.length;
    const s = Math.min(95, Math.floor(hours * 4));
    const rows = meta.branches
      .map((b, i) => ({ b, n1: day.n1Loading[s * nb + i]!, cause: day.n1Cause[s * nb + i]! }))
      .filter((r) => r.n1 > 1)
      .sort((a, b) => b.n1 - a.n1);
    const top = rows[0];
    ui.say(
      rows.length
        ? `Contingency sweep at ${fmtHour(hours)}: ${rows.length} circuits exceed rating under a single outage. Worst: ${top!.b.label} at ${Math.round(top!.n1 * 100)}% after ${meta.contingencyLabels[top!.cause]}.`
        : `Contingency sweep at ${fmtHour(hours)}: every circuit stays within rating under any single outage.`,
    );
    ui.set({ feedOpen: true, minSeverity: 'warning' });
  };

  return (
    <section
      className="halo absolute right-8 top-24 z-20 w-[264px] select-none border hairline px-5 pb-5 pt-4 backdrop-blur-sm"
      style={{ background: 'var(--panel)' }}
      aria-label="Scenario and inputs"
    >
      <p className="flex justify-between text-[10px] uppercase tracking-[0.18em] text-ink-soft">
        Scenario <SourceTag s="Assumption" />
      </p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {(Object.keys(scenarios) as ScenarioId[]).map((id, i) => (
          <button
            key={id}
            title={scenarios[id].title}
            onClick={() => {
              applyScenario(id);
              ui.set({ decisions: {}, selectedBranch: null, selectedAgent: null });
            }}
            className={`group flex flex-col items-start gap-1 ${inputs.scenario === id ? '' : 'opacity-60 hover:opacity-100'}`}
          >
            <span className={`block h-7 w-full border ${inputs.scenario === id ? 'border-ink' : 'hairline'}`} style={{ background: swatch[id] }} />
            <span className="figure text-[10px] text-ink-soft">{i + 1}</span>
          </button>
        ))}
      </div>
      <p className="caption mt-2 text-[14px] leading-tight text-ink">{sc.title}</p>

      <Slider label="Wind" left="still" right="gale" min={0.2} max={1.8} step={0.05} value={inputs.windScale} onChange={(v) => setInputs({ windScale: v })} readout={`${Math.round(inputs.windScale * 100)}%`} />
      <Slider label="Demand growth" left="2026" right="2034" min={2026} max={2034} step={1} value={year} onChange={(v) => setInputs({ year: v })} readout={String(year)} />
      <Slider label="Interconnector" left="export" right="import" min={-1} max={1} step={0.05} value={ic} onChange={(v) => setInputs({ icShare: v })} readout={`${ic > 0 ? 'import' : ic < 0 ? 'export' : 'balanced'} ${Math.abs(Math.round(ic * 100))}%`} />
      <Slider
        label="Rule maturity"
        left="base"
        right="extended"
        min={0}
        max={1}
        step={1}
        value={ui.maturity === 'base' ? 0 : 1}
        onChange={(v) => ui.set({ maturity: v ? 'extended' : 'base' })}
        readout={ui.maturity}
      />
      {inputs.commsLostFromHour !== null && (
        <div className="mt-4 border-t hairline pt-3">
          <p className="text-[10px] uppercase tracking-[0.16em] text-ink-soft">Stale data policy</p>
          <div className="mt-1.5 flex gap-3 text-[12px]">
            {(['consistency', 'availability'] as const).map((p) => (
              <button key={p} onClick={() => setInputs({ stalePolicy: p })} className={inputs.stalePolicy === p ? 'text-ink underline underline-offset-4' : 'text-ink-soft'}>
                {p === 'consistency' ? 'Prefer consistency' : 'Prefer availability'}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10.5px] leading-snug text-ink-faint">
            {inputs.stalePolicy === 'consistency'
              ? 'Actions on assets with stale data are withheld until communications return.'
              : 'Last known state is used for stale assets; actions are flagged and confidence is reduced.'}
          </p>
        </div>
      )}
      <div className="mt-5 flex items-center justify-between border-t hairline pt-3 text-[12px]">
        <button className="text-ink underline underline-offset-4" onClick={sweep}>
          Run contingency sweep
        </button>
        <button
          className="text-ink-soft underline underline-offset-4"
          onClick={() => {
            applyScenario(inputs.scenario);
            ui.set({ decisions: {}, selectedBranch: null, selectedAgent: null });
          }}
        >
          Reset
        </button>
      </div>
    </section>
  );
}
