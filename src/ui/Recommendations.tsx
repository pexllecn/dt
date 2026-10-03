import { useState } from 'react';
import { useWorld } from '@/app/store';
import { useSim } from '@/sim/client';
import type { Recommendation } from '@/agents/engine';
import { fmtHour, useUi } from './uiStore';

function inputsHash(obj: unknown): string {
  const s = JSON.stringify(obj);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/**
 * The human in the loop. Each recommendation from the coordinator waits for an explicit
 * Approve, Reject or Modify; every decision goes to the audit trail.
 */
export function Recommendations() {
  const agents = useSim((s) => s.agents);
  const inputs = useSim((s) => s.inputs);
  const meta = useSim((s) => s.meta);
  const setInputs = useSim((s) => s.setInputs);
  const ui = useUi();
  const [scale, setScale] = useState(1);
  const [modifying, setModifying] = useState(false);
  // Re-render when the 15-minute interval changes, not on a timer.
  const hours = useWorld((s) => Math.min(95, Math.floor(s.hours * 4))) / 4;
  if (!agents || !meta || inputs.scenario === 'hero' || inputs.scenario === 'y2034') return null;
  const step = Math.floor(hours * 4);
  const pending = agents.recommendations.filter((r) => r.step <= step && !ui.decisions[r.id] && !inputs.adjustments.some((a) => a.fromHour === r.step / 4));
  const rec: Recommendation | undefined = pending[pending.length - 1];
  if (!rec) return null;

  const k = modifying ? scale : 1;
  const fmtMW = (mw: number) => `${mw > 0 ? '+' : ''}${Math.round(mw * k)} MW`;
  const pairs: [Recommendation['actions'][number], Recommendation['actions'][number] | undefined][] = [];
  for (let i = 0; i < rec.actions.length; i += 2) pairs.push([rec.actions[i]!, rec.actions[i + 1]]);

  const decide = (decision: 'approved' | 'rejected' | 'modified and approved') => {
    const f = decision === 'modified and approved' ? scale : 1;
    const actions = rec.actions.map((a) => ({ ...a, deltaMW: Math.round(a.deltaMW * f) }));
    if (decision !== 'rejected') {
      const windIdx = (id: string) => (id.startsWith('W-') ? Number(id.slice(2)) : undefined);
      setInputs({
        adjustments: [
          ...inputs.adjustments,
          ...actions.map((a) => ({ bus: a.bus, deltaMW: a.deltaMW, fromHour: rec.step / 4, windCluster: windIdx(a.assetId) })),
        ],
      });
    }
    ui.record({
      at: new Date().toISOString(),
      simHour: rec.step / 4,
      scenario: inputs.scenario,
      operator: 'Presenter',
      decision,
      recommendationId: rec.id,
      title: rec.title,
      actions: actions.map((a) => ({ assetName: a.assetName, deltaMW: a.deltaMW })),
      ruleSetVersion: rec.ruleSetVersion,
      ruleSetHash: rec.ruleSetHash,
      inputsHash: inputsHash(inputs),
    });
    ui.say(decision === 'rejected' ? `Recommendation rejected and logged: ${rec.title}.` : `Approved and logged. ${rec.title}: actions apply from ${fmtHour(rec.step / 4)}.`);
    setModifying(false);
    setScale(1);
  };

  return (
    <section
      className="absolute left-8 top-[124px] z-20 max-h-[calc(100%-330px)] w-[400px] overflow-y-auto border border-ink px-5 pb-4 pt-4 shadow-[0_12px_40px_rgba(0,0,0,0.12)] backdrop-blur-md"
      style={{ background: 'var(--panel)' }}
      role="dialog"
      aria-label="Recommendation awaiting decision"
    >
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase tracking-[0.18em] text-crimson">Recommendation · awaiting decision</p>
        <p className="figure text-[11px] text-ink-soft">{fmtHour(rec.step / 4)}</p>
      </div>
      <h3 className="caption mt-1.5 text-[21px] leading-tight text-ink">{rec.title}</h3>
      <p className="mt-1.5 text-[12px] leading-snug text-ink-soft">{rec.summary}</p>
      <ol className="mt-3 border-t hairline text-[11.5px]">
        {pairs.map(([d, u], i) => (
          <li key={i} className="grid grid-cols-[1fr_auto] gap-x-3 border-b hairline py-1.5">
            <span className="truncate text-ink">
              {d.assetName}
              {d.stale && <span className="ml-1.5 text-[10px] uppercase tracking-[0.1em] text-crimson">stale</span>}
            </span>
            <span className="figure text-ink">{fmtMW(d.deltaMW)}</span>
            {u && (
              <>
                <span className="truncate text-ink-soft">
                  <span className="text-ink-faint">to </span>
                  {u.assetName}
                  {u.stale && <span className="ml-1.5 text-[10px] uppercase tracking-[0.1em] text-crimson">stale</span>}
                </span>
                <span className="figure text-ok">{fmtMW(u.deltaMW)}</span>
              </>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-3 grid grid-cols-3 gap-3 text-[11px]">
        <div>
          <p className="text-ink-faint">loading now</p>
          <p className="figure text-[15px] text-crimson">{Math.round(rec.beforeLoading * 100)}%</p>
        </div>
        <div>
          <p className="text-ink-faint">expected after</p>
          <p className="figure text-[15px] text-ink">{Math.round((rec.beforeLoading - (rec.beforeLoading - rec.afterLoading) * (modifying ? scale : 1)) * 100)}%</p>
        </div>
        <div>
          <p className="text-ink-faint">confidence</p>
          <p className="figure text-[15px] text-ink">{Math.round(rec.confidence * 100)}%</p>
        </div>
      </div>
      {rec.withheld.length > 0 && (
        <p className="mt-3 text-[11px] leading-snug text-ink-soft">
          Withheld: {rec.withheld.slice(0, 3).map((w) => w.assetName).join(', ')}
          {rec.withheld.length > 3 ? ` and ${rec.withheld.length - 3} more` : ''} (data stale; consistency preferred).
        </p>
      )}
      <p className="mt-3 text-[10.5px] text-ink-faint">
        {rec.method} · rules {rec.rulesFired.join(', ')} · rule set {rec.ruleSetVersion} ({rec.ruleSetHash})
      </p>
      {modifying && (
        <div className="mt-3">
          <input type="range" min={0.5} max={1.5} step={0.05} value={scale} onChange={(e) => setScale(Number(e.target.value))} className="specimen-range w-full" aria-label="Scale actions" />
          <p className="figure text-[11px] text-ink-soft">actions at {Math.round(scale * 100)}% of the proposal</p>
        </div>
      )}
      <div className="mt-4 flex gap-3">
        <button className="border border-ink bg-ink px-4 py-1.5 text-[12px] text-ground" onClick={() => decide(modifying ? 'modified and approved' : 'approved')}>
          {modifying ? 'Approve modified' : 'Approve'}
        </button>
        <button className="border border-ink px-4 py-1.5 text-[12px] text-ink" onClick={() => decide('rejected')}>
          Reject
        </button>
        <button className="px-2 py-1.5 text-[12px] text-ink-soft underline underline-offset-4" onClick={() => setModifying(!modifying)}>
          {modifying ? 'Cancel modify' : 'Modify'}
        </button>
      </div>
    </section>
  );
}

export function AuditLog() {
  const ui = useUi();
  if (!ui.auditOpen) return null;
  const download = () => {
    const blob = new Blob([JSON.stringify(ui.audit, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cognitive-grid-twin-audit.json';
    a.click();
  };
  return (
    <section className="absolute left-1/2 top-1/2 z-40 w-[640px] -translate-x-1/2 -translate-y-1/2 border border-ink px-7 pb-6 pt-6 backdrop-blur-md" style={{ background: 'var(--panel)' }} role="dialog" aria-label="Audit trail">
      <div className="flex items-baseline justify-between">
        <h2 className="caption text-[24px] text-ink">Audit trail</h2>
        <div className="flex gap-4 text-[11px]">
          <button className="text-ink underline underline-offset-4" onClick={download}>
            export JSON
          </button>
          <button className="text-ink-soft underline underline-offset-4" onClick={() => ui.set({ auditOpen: false })}>
            close
          </button>
        </div>
      </div>
      <p className="mt-1 text-[11.5px] text-ink-soft">Every decision on a recommendation, with the rule set and inputs it was made against.</p>
      <ol className="mt-4 max-h-[420px] overflow-y-auto">
        {ui.audit.length === 0 && <li className="caption py-4 text-[14px] text-ink-soft">No decisions yet.</li>}
        {[...ui.audit].reverse().map((a, i) => (
          <li key={i} className="border-b hairline py-2.5 text-[12px]">
            <div className="flex justify-between">
              <span className="text-ink">
                <span className={a.decision === 'rejected' ? 'text-crimson' : 'text-ok'}>{a.decision}</span> · {a.title}
              </span>
              <span className="figure text-ink-soft">sim {fmtHour(a.simHour)}</span>
            </div>
            <p className="figure mt-0.5 text-[10.5px] text-ink-faint">
              {a.operator} · {new Date(a.at).toLocaleString('en-IE')} · rules {a.ruleSetVersion} ({a.ruleSetHash}) · inputs {a.inputsHash} · {a.recommendationId}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
