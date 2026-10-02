import { useState } from 'react';
import { allRules, RULESET_VERSION, ruleSetHash } from '@/agents/rules';
import type { AssetType, Maturity } from '@/agents/types';
import { useSim } from '@/sim/client';
import { ALL_TYPES, typeLabel, useUi } from './uiStore';
import { SourceTag } from './SourceTag';
import type { SourceLabel } from '@/lib/sourced';

const method: { h: string; p: string; s: SourceLabel }[] = [
  {
    h: 'Network',
    p: 'Stations, lines and cables come from OpenStreetMap (via Overture Maps, ODbL). Routes are traced; three Dublin 220 kV cables missing from the map are added from public network maps; circuit counts, conductor types and ratings are assumed by voltage class and checked against public figures where they exist. Northern Ireland is simulated for flows and shown greyed.',
    s: 'Approximate',
  },
  {
    h: 'Power flow',
    p: 'A DC load flow over 96 quarter hours of a day. Demand is spread by population and station; generation follows a merit order with a minimum number of synchronous units and a 75% SNSP cap. The schedule is then constrained on the planned network: no circuit above 95% intact, and the worst single outage within a 120% short-term limit, by moving generation (wind first) using sensitivities. Every circuit is checked against every single outage (N-1) using outage distribution factors. Trips after the schedule are left to the agents and the operator.',
    s: 'Synthetic',
  },
  {
    h: 'Weather and wind',
    p: 'A synthetic wind field with fronts and exposure drives turbine output, conductor cooling and blow-out. It is not a forecast and is not tied to any real date.',
    s: 'Synthetic',
  },
  {
    h: 'Thermal models',
    p: 'Conductor temperature follows a simplified IEEE 738 heat balance; sag follows thermal elongation. Transformer top-oil and hot-spot temperatures and ageing follow IEC 60076-7; dissolved gas is read with the Duval triangle.',
    s: 'Assumption',
  },
  {
    h: 'Agents',
    p: 'One agent per asset. Each agent applies a fixed, versioned rule set to what it can see: its own measurements and the state its neighbours publish. Nothing is learned at run time. Every entry in the feed names the rule, its inputs, the threshold and the outcome.',
    s: 'Assumption',
  },
  {
    h: 'Recommendations',
    p: 'The coordinator proposes re-dispatch only, using sensitivities of the overloaded circuit to injections at each bus. It never acts: every proposal waits for a person to approve, reject or modify it, and each decision is written to the audit trail with the rule set version and an inputs hash.',
    s: 'Assumption',
  },
  {
    h: 'What this is not',
    p: 'This is not connected to any control system and shows no live data. Figures are synthetic, calibrated to public totals, and should not be read as statements about the real network.',
    s: 'Public',
  },
];

/** Method notes: how the figures are made, with the provenance of each part. */
export function Notes() {
  const ui = useUi();
  if (!ui.notesOpen) return null;
  return (
    <section
      className="absolute left-8 top-[124px] z-30 max-h-[calc(100%-300px)] w-[440px] overflow-y-auto border hairline px-6 pb-5 pt-5 backdrop-blur-md"
      style={{ background: 'var(--panel)' }}
      aria-label="Method notes"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="caption text-[24px] text-ink">Method</h2>
        <button className="text-[11px] text-ink-soft underline underline-offset-4" onClick={() => ui.set({ notesOpen: false })}>
          close
        </button>
      </div>
      {method.map((m) => (
        <div key={m.h} className="mt-3.5">
          <p className="flex items-baseline justify-between text-[10px] uppercase tracking-[0.16em] text-ink-soft">
            {m.h} <SourceTag s={m.s} />
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink">{m.p}</p>
        </div>
      ))}
    </section>
  );
}

/** Governance view: the frozen rule catalogue, its version and hash, and the decision policy. */
export function Governance() {
  const ui = useUi();
  const meta = useSim((s) => s.meta);
  const [type, setType] = useState<AssetType>('line');
  const [mat, setMat] = useState<Maturity | 'all'>('all');
  if (!ui.governanceOpen) return null;
  const rules = allRules.filter((r) => r.assetType === type && (mat === 'all' || r.maturity === mat));
  const count = (t: AssetType) => allRules.filter((r) => r.assetType === t).length;
  return (
    <section
      className="absolute left-1/2 top-1/2 z-40 flex h-[min(720px,calc(100%-120px))] w-[860px] -translate-x-1/2 -translate-y-1/2 flex-col border border-ink px-7 pb-5 pt-6 backdrop-blur-md"
      style={{ background: 'var(--panel)' }}
      role="dialog"
      aria-label="Governance"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="caption text-[26px] text-ink">Governance</h2>
        <button className="text-[11px] text-ink-soft underline underline-offset-4" onClick={() => ui.set({ governanceOpen: false })}>
          close
        </button>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-6 border-b hairline pb-4 text-[12px] leading-relaxed text-ink">
        <p>
          <span className="block text-[10px] uppercase tracking-[0.16em] text-ink-soft">Authority</span>
          Agents observe, alarm and recommend. They take no action on the system. Every recommendation needs a named person to approve, reject or modify it.
        </p>
        <p>
          <span className="block text-[10px] uppercase tracking-[0.16em] text-ink-soft">Rule set</span>
          <span className="figure">
            v{RULESET_VERSION} · {ruleSetHash()} · {allRules.length} rules · {meta?.agents.length ?? 0} agents
          </span>
          <br />
          Frozen at build time. Each rule is unit tested against examples that must fire and must not.
        </p>
        <p>
          <span className="block text-[10px] uppercase tracking-[0.16em] text-ink-soft">Stale data</span>
          When communications are lost, rules that need fresh data are suspended and the policy chosen by the operator decides whether actions on those assets are withheld or flagged.
        </p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {ALL_TYPES.map((t) => (
          <button key={t} onClick={() => setType(t)} className={`rounded-full border px-2.5 py-0.5 text-[10.5px] ${type === t ? 'border-ink text-ink' : 'hairline text-ink-faint'}`}>
            {typeLabel[t]} <span className="figure">{count(t)}</span>
          </button>
        ))}
        <span className="ml-auto flex gap-3 text-[10.5px] text-ink-soft">
          {(['all', 'base', 'extended'] as const).map((m) => (
            <button key={m} onClick={() => setMat(m)} className={mat === m ? 'text-ink underline underline-offset-4' : ''}>
              {m}
            </button>
          ))}
        </span>
      </div>
      <div className="mt-2 flex-1 overflow-y-auto">
        <table className="w-full text-[11.5px]">
          <thead className="sticky top-0 text-ink-faint" style={{ background: 'var(--panel)' }}>
            <tr className="border-b hairline text-left">
              <th className="py-1.5 pr-3 font-normal">rule</th>
              <th className="py-1.5 pr-3 font-normal">text</th>
              <th className="py-1.5 pr-3 font-normal">threshold</th>
              <th className="py-1.5 font-normal">severity</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-b hairline align-top">
                <td className="figure py-1.5 pr-3 text-ink">
                  {r.id}
                  <span className="block text-[10px] text-ink-faint">
                    v{r.version} · {r.maturity}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-ink">
                  {r.description}
                  {r.reference && <span className="block text-[10.5px] text-ink-faint">{r.reference}</span>}
                </td>
                <td className="figure whitespace-nowrap py-1.5 pr-3 text-ink">
                  {r.threshold.op} {r.threshold.value} {r.threshold.unit}
                  <span className="block">
                    <SourceTag s={r.threshold.source} />
                  </span>
                </td>
                <td className={`py-1.5 ${r.severity === 'critical' ? 'text-crimson' : r.severity === 'warning' ? 'text-amber' : 'text-ink-soft'}`}>{r.severity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
