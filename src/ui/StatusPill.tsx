export type PillState = { label: string; tone: 'running' | 'paused' | 'alert' | 'idle' };

const dot: Record<PillState['tone'], string> = {
  running: 'bg-ok breathe',
  paused: 'bg-ink-faint',
  alert: 'bg-crimson breathe',
  idle: 'bg-ink-faint',
};

export function StatusPill({ state }: { state: PillState }) {
  const alert = state.tone === 'alert';
  return (
    <div
      className={`pointer-events-none absolute right-8 top-7 flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 backdrop-blur-sm ${
        alert ? 'border-crimson text-crimson' : 'hairline text-ink'
      }`}
      style={{ background: 'var(--panel)' }}
      role="status"
    >
      <span className={`inline-block h-[7px] w-[7px] rounded-full ${dot[state.tone]}`} />
      <span className="figure text-[11px] tracking-[0.14em]">{state.label}</span>
    </div>
  );
}
