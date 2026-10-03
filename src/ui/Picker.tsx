import { useEffect } from 'react';
import { bridge, project } from '@/app/bridge';
import { useSim } from '@/sim/client';
import { useUi } from './uiStore';

/** Click (not drag) on the scene selects the nearest line or transformer under the cursor. */
export function Picker() {
  useEffect(() => {
    const want = new URLSearchParams(location.search).get('branch');
    if (!want) return;
    const pick = () => {
      const meta = useSim.getState().meta;
      const b = meta?.branches.find((x) => x.label === want || x.id === want);
      if (!b || !meta) return false;
      useUi.getState().set({ selectedBranch: b.id, selectedAgent: meta.agents.find((a) => a.ref === b.id)?.id ?? null });
      return true;
    };
    if (pick()) return;
    return useSim.subscribe(() => void pick());
  }, []);

  useEffect(() => {
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.target instanceof HTMLCanvasElement && e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: PointerEvent) => {
      if (!down || !(e.target instanceof HTMLCanvasElement)) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4 || !bridge.pickBranch) return;
      const r = e.target.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const meta = useSim.getState().meta;
      const ui = useUi.getState();
      const sim = useSim.getState();
      if (ui.tool === 'load' && meta) {
        // Nearest station (110 kV bus preferred) within a few pixels of the click.
        let best: { id: string; name: string; d: number } | null = null;
        for (const b of meta.buses) {
          const p = project(b.e, b.n, 0, r.width, r.height);
          if (!p) continue;
          const d = Math.hypot(p.x - px, p.y - py) + (b.kv === 110 ? 0 : 6);
          if (d < 26 && (!best || d < best.d)) best = { id: b.id, name: `${b.name} ${b.kv} kV`, d };
        }
        if (!best) return ui.say('Load: click on a station to add 50 MW of demand there.');
        const now = sim.inputs.extraLoad[best.id] ?? 0;
        sim.setInputs({ extraLoad: { ...sim.inputs.extraLoad, [best.id]: now + 50 } });
        return ui.say(`Load: ${now + 50} MW of new demand at ${best.name}. The day is recomputed.`);
      }
      const i = bridge.pickBranch(px, py, r.width, r.height);
      if (ui.tool === 'cut' && i >= 0 && meta) {
        const b = meta.branches[i]!;
        sim.trip(b.id);
        ui.set({ selectedBranch: b.id, selectedAgent: meta.agents.find((a) => a.ref === b.id)?.id ?? null });
        return ui.say(`Cut: ${b.label} taken out of service. Flows and every N-1 check are recomputed.`);
      }
      if (ui.tool === 'restore' && meta) {
        const b = i >= 0 ? meta.branches[i]! : null;
        if (b && sim.inputs.outages.includes(b.id)) {
          sim.restore(b.id);
          return ui.say(`Restore: ${b.label} back in service.`);
        }
        return ui.say('Restore: click a circuit that is out of service, or use Restore all.');
      }
      if (i >= 0 && meta) {
        const id = meta.branches[i]!.id;
        const agent = meta.agents.find((a) => a.ref === id);
        ui.set({ selectedBranch: id, selectedAgent: agent?.id ?? null });
      } else if (ui.selectedBranch) ui.set({ selectedBranch: null, selectedAgent: null });
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);
  return null;
}
