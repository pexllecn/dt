import { useWorld } from '@/app/store';

export function LoadingVeil() {
  const ready = useWorld((s) => s.ready);
  const message = useWorld((s) => s.loadingMessage);
  return (
    <div
      className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-1000 ${
        ready ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ background: 'var(--ground)' }}
      aria-hidden={ready}
    >
      <p className="caption text-[18px] text-ink-soft">{message}</p>
    </div>
  );
}
