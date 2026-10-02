import { presentation } from '@/config/presentation';

/** Shown when neither WebGPU nor WebGL2 is available. Points to the recorded scenarios. */
export function FallbackCard({ reason }: { reason: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-[560px] border hairline px-10 py-9" style={{ background: 'var(--panel)' }}>
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-soft">{presentation.productName}</p>
        <h2 className="caption mt-3 text-[28px] leading-tight text-ink">This display cannot run the live twin.</h2>
        <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">
          {reason} The four scenarios are available as recordings made from the same build.
        </p>
        <ul className="mt-6 divide-y divide-[var(--hairline)] border-y hairline text-[14px]">
          {[
            ['The grid today', 'video/01-today.mp4'],
            ['A 50 MW connection request in the north west', 'video/02-hero.mp4'],
            ['Storm event', 'video/03-storm.mp4'],
            ['2034', 'video/04-2034.mp4'],
          ].map(([title, href]) => (
            <li key={href} className="flex items-baseline justify-between py-2.5">
              <span className="caption text-ink">{title}</span>
              <a className="figure text-[11px] text-ink-soft underline-offset-4 hover:underline" href={href}>
                play recording
              </a>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[11px] text-ink-faint">{presentation.dataBadge}</p>
      </div>
    </div>
  );
}
