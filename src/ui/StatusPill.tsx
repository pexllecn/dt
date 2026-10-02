export type PillState = { label: string; tone: 'running' | 'paused' | 'alert' | 'idle' };

const dot: Record<PillState['tone'], string> = {
  running: 'bg-ok breathe',
  paused: 'bg-ink-faint',
  alert: 'bg-crimson breathe',
  idle: 'bg-ink-faint',
};

export function StatusPill({ state, offset = 32 }: { state: PillState; offset?: number }) {
  const alert = state.tone === 'alert';
  return (
    <div
      className={`pointer-events-none absolute top-7 z-40 flex transition-[right] duration-500 items-center gap-2.5 rounded-full border px-3.5 py-1.5 backdrop-blur-sm ${
        alert ? 'border-crimson text-crimson' : 'hairline text-ink'
      }`}
      style={{ background: 'var(--panel)', right: offset }}
      role="status"
    >
      <span className={`inline-block h-[7px] w-[7px] rounded-full ${dot[state.tone]}`} />
      <span className="figure text-[11px] tracking-[0.14em]">{state.label}</span>
    </div>
  );
}
