import { useSim } from '@/sim/client';
import { useUi, type UiState } from './uiStore';

const TOOLS: { id: UiState['tool']; label: string; hint: string }[] = [
  { id: 'hand', label: 'Hand', hint: 'Orbit, pan and select' },
  { id: 'cut', label: 'Cut', hint: 'Click a circuit to take it out of service' },
  { id: 'load', label: 'Load', hint: 'Click a station to add 50 MW of demand' },
  { id: 'restore', label: 'Restore', hint: 'Click a circuit that is out to return it' },
];

/** Map tools, bottom right. Every change goes to the simulation, which recomputes the day. */
export function ToolDock() {
  const tool = useUi((s) => s.tool);
  const set = useUi((s) => s.set);
  const say = useUi((s) => s.say);
  const inputs = useSim((s) => s.inputs);
  const setInputs = useSim((s) => s.setInputs);
  const changes = inputs.outages.length + Object.keys(inputs.extraLoad).length;
  return (
    <div className="halo absolute bottom-[104px] right-8 z-20 flex items-center gap-1 text-[11.5px]" role="toolbar" aria-label="Map tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          title={t.hint}
          aria-pressed={tool === t.id}
          onClick={() => set({ tool: t.id })}
          className={`border px-2.5 py-1 ${tool === t.id ? 'border-ink bg-ink text-ground' : 'hairline text-ink'}`}
          style={tool === t.id ? undefined : { background: 'var(--panel)' }}
        >
          {t.label}
        </button>
      ))}
      {changes > 0 && (
        <button
          className="ml-2 text-ink-soft underline underline-offset-4"
          onClick={() => {
            setInputs({ outages: [], extraLoad: {} });
            say('Restored: all cuts and added loads removed.');
          }}
        >
          Restore all ({changes})
        </button>
      )}
    </div>
  );
}
