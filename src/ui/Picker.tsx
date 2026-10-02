import { useEffect } from 'react';
import { bridge } from '@/app/bridge';
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
      const i = bridge.pickBranch(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
      const meta = useSim.getState().meta;
      const ui = useUi.getState();
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
