import { useEffect, useState } from 'react';
import { useUi } from './uiStore';

/** One italic serif line, centred low on screen, that fades after a few seconds. */
export function Toast() {
  const toast = useUi((s) => s.toast);
  const [shown, setShown] = useState<{ text: string; seq: number } | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    setVisible(true);
    const ms = Math.min(12_000, 3_500 + toast.text.length * 45);
    const id = setTimeout(() => setVisible(false), ms);
    return () => clearTimeout(id);
  }, [toast]);
  if (!shown) return null;
  return (
    <div
      className={`halo pointer-events-none absolute left-1/2 top-[76px] z-30 w-[620px] -translate-x-1/2 text-center transition-opacity duration-700 ${visible ? 'opacity-100' : 'opacity-0'}`}
      role="status"
      aria-live="polite"
    >
      <p className="caption text-[17px] leading-snug text-ink">{shown.text}</p>
    </div>
  );
}
