import { presentation } from '@/config/presentation';

export function Masthead() {
  return (
    <header className="halo pointer-events-none absolute left-8 top-7 select-none">
      <div className="flex items-baseline gap-4">
        <h1 className="caption text-[34px] leading-none tracking-[-0.01em] text-ink">{presentation.productName}</h1>
        {presentation.partnerLogo && (
          <img src={presentation.partnerLogo} alt={presentation.partnerLogoAlt} className="h-6 opacity-90" />
        )}
      </div>
      <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-ink-soft">{presentation.strapline}</p>
    </header>
  );
}
