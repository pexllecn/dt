import { useEffect, useState } from 'react';
import { frameStats, useWorld } from '@/app/store';

/** Behind the D key: frame rate, frame time, draw calls, triangles, terrain nodes, backend. */
export function DebugOverlay() {
  const debug = useWorld((s) => s.debug);
  const backend = useWorld((s) => s.backend);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!debug) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [debug]);
  if (!debug) return null;
  const rows: [string, string][] = [
    ['backend', backend ?? 'none'],
    ['fps', frameStats.fps.toFixed(1)],
    ['frame', `${frameStats.frameMs.toFixed(1)} ms`],
    ['update', `${frameStats.updateMs.toFixed(2)} ms`],
    ['submit', `${frameStats.submitMs.toFixed(2)} ms`],
    ['pixel ratio', frameStats.dpr.toFixed(2)],
    ['draws', String(frameStats.drawCalls)],
    ['triangles', `${(frameStats.triangles / 1e6).toFixed(2)} M`],
    ['terrain nodes', String(frameStats.terrainNodes)],
    ['altitude', `${(frameStats.altitude / 1000).toFixed(1)} km`],
    ['exaggeration', `${frameStats.exaggeration.toFixed(2)}x`],
    ['supports', String(frameStats.supports)],
    ['conductors', String(frameStats.conductors)],
    ['turbines', String(frameStats.turbines)],
  ];
  return (
    <div
      className="figure pointer-events-none absolute left-8 top-36 border hairline px-3 py-2 text-[10.5px] leading-[1.55] text-ink backdrop-blur-sm"
      style={{ background: 'var(--panel)' }}
    >
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-6">
          <span className="text-ink-faint">{k}</span>
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}
