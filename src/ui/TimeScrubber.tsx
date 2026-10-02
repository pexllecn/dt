import { useCallback, useRef } from 'react';
import { useWorld } from '@/app/store';

const fmt = (h: number) => {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

/** Hairline timeline along the bottom edge: 24 hours at 15-minute resolution. */
export function TimeScrubber() {
  const hours = useWorld((s) => s.hours);
  const date = useWorld((s) => s.date);
  const setHours = useWorld((s) => s.setHours);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useCallback(
    (e: React.PointerEvent) => {
      const r = bar.current!.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      setHours(Math.round(t * 24 * 4) / 4);
    },
    [setHours],
  );
  const pct = (hours / 24) * 100;
  const label = new Date(Date.UTC(date.y, date.m - 1, date.d)).toLocaleDateString('en-IE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <div className="absolute bottom-9 left-8 right-8 select-none">
      <div className="mb-1.5 flex items-baseline justify-between text-[10px] tracking-[0.12em] text-ink-soft">
        <span className="caption text-[13px] tracking-normal text-ink">{label}</span>
        <span className="figure text-[12px] text-ink">{fmt(hours)}</span>
      </div>
      <div
        ref={bar}
        className="relative h-4 cursor-ew-resize"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag(e);
        }}
        onPointerMove={(e) => e.buttons === 1 && drag(e)}
        role="slider"
        aria-label="Time of day"
        aria-valuemin={0}
        aria-valuemax={24}
        aria-valuenow={hours}
      >
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-[var(--hairline)]" />
        {Array.from({ length: 25 }, (_, i) => (
          <div
            key={i}
            className="absolute top-1/2 w-px bg-[var(--hairline)]"
            style={{ left: `${(i / 24) * 100}%`, height: i % 6 === 0 ? 9 : 4, transform: 'translateY(-50%)' }}
          />
        ))}
        <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-ink" style={{ left: `${pct}%` }} />
        <div className="absolute left-0 top-1/2 h-px -translate-y-1/2 bg-ink" style={{ width: `${pct}%` }} />
      </div>
      <div className="figure mt-0.5 flex justify-between text-[9px] text-ink-faint">
        {['00', '06', '12', '18', '24'].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}
