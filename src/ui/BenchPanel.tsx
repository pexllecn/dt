import { useBench } from '@/app/bench';

export function BenchPanel() {
  const { result, running } = useBench();
  if (!running && !result) return null;
  return (
    <div
      className="absolute right-8 top-24 w-[340px] border hairline px-5 py-4 text-ink backdrop-blur-sm"
      style={{ background: 'var(--panel)' }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-ink-soft">Benchmark</p>
      {running && <p className="caption mt-2 text-[15px]">Flying the fixed path. Please do not touch the controls.</p>}
      {result && (
        <>
          <p className="figure mt-2 text-[11px] text-ink-soft">
            {result.backend} · {result.width} x {result.height} · dpr {result.dpr}
          </p>
          <table className="figure mt-3 w-full text-[12px]">
            <thead className="text-ink-faint">
              <tr>
                <th className="text-left font-normal">tier</th>
                <th className="text-right font-normal">fps</th>
                <th className="text-right font-normal">p50 ms</th>
                <th className="text-right font-normal">p95 ms</th>
              </tr>
            </thead>
            <tbody>
              {result.segments.map((s) => (
                <tr key={s.name} className="border-t hairline">
                  <td className="py-1">{s.name}</td>
                  <td className="text-right">{s.fps.toFixed(1)}</td>
                  <td className="text-right">{s.p50.toFixed(1)}</td>
                  <td className="text-right">{s.p95.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="mt-3 text-[11px] text-ink-soft underline underline-offset-4"
            onClick={() => void navigator.clipboard.writeText(JSON.stringify(result, null, 2))}
          >
            copy result
          </button>
        </>
      )}
    </div>
  );
}
