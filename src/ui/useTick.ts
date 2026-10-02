import { useEffect, useState } from 'react';

/** Re-render at a fixed interval (for panels that read the simulated clock). */
export function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
