import type { SourceLabel } from '@/lib/sourced';

/** Small provenance tag: Public, Synthetic, Assumption or Approximate. */
export function SourceTag({ s }: { s: SourceLabel }) {
  return <span className="text-[9px] uppercase tracking-[0.12em] text-ink-faint">{s}</span>;
}
