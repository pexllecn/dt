import { presentation } from '@/config/presentation';

/** Permanent, unobtrusive honesty badge. */
export function DataBadge() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 select-none whitespace-nowrap text-[10px] tracking-[0.02em] text-ink-faint">
      {presentation.dataBadge}
    </div>
  );
}
