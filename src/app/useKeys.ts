import { useEffect } from 'react';
import { useWorld } from './store';
import { useSim } from '@/sim/client';
import { useUi } from '@/ui/uiStore';
import type { ScenarioId } from '@/sim/scenarios';

const SCENARIO_KEYS: Record<string, ScenarioId> = { '1': 'today', '2': 'hero', '3': 'storm', '4': 'y2034' };

/**
 * Presenter keys: Space time-lapse, Left/Right step a quarter hour, 1 to 4 scenarios, R reset,
 * T theme, N method notes, D debug, F fullscreen, Esc closes panels.
 */
export function useKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      const s = useWorld.getState();
      const ui = useUi.getState();
      const sim = useSim.getState();
      const scenario = SCENARIO_KEYS[e.key];
      if (scenario) {
        sim.applyScenario(scenario);
        ui.set({ decisions: {}, selectedBranch: null, selectedAgent: null });
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'arrowleft':
        case 'arrowright': {
          const step = e.key === 'ArrowRight' ? 0.25 : -0.25;
          s.setHours(Math.min(23.99, Math.max(0, Math.round((s.hours + step) * 4) / 4)));
          break;
        }
        case 'r':
          sim.applyScenario(sim.inputs.scenario);
          ui.set({ decisions: {}, selectedBranch: null, selectedAgent: null });
          break;
        case 'n':
          ui.set({ notesOpen: !ui.notesOpen });
          break;
        case 'escape':
          ui.set({ notesOpen: false, auditOpen: false, governanceOpen: false, feedOpen: false, selectedBranch: null, selectedAgent: null });
          break;
        case 't':
          s.toggleTheme();
          break;
        case 'd':
          s.toggleDebug();
          break;
        case 'f':
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen();
          break;
        case ' ':
          e.preventDefault();
          s.setTimeRate(s.timeRate === 0 ? 0.8 : 0);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
