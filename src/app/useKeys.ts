import { useEffect } from 'react';
import { useWorld } from './store';
import { useSim } from '@/sim/client';
import { useUi } from '@/ui/uiStore';
import type { ScenarioId } from '@/sim/scenarios';
import { useDirector } from '@/director/store';

const SCENARIO_KEYS: Record<string, ScenarioId> = { '1': 'today', '2': 'hero', '3': 'storm', '4': 'y2034' };

/**
 * Presenter keys. Director mode: Space play or pause, Left/Right beats, 1 to 4 scripts.
 * Explore mode: Space time-lapse, Left/Right a quarter hour, 1 to 4 scenarios.
 * Both: D Director or Explore, R reset, T theme, N narration, F fullscreen, ` debug, Esc closes panels.
 */
export function useKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      const s = useWorld.getState();
      const ui = useUi.getState();
      const sim = useSim.getState();
      const dir = useDirector.getState();
      const director = dir.mode === 'director';
      const resetUi = () =>
        ui.set({ decisions: {}, selectedBranch: null, selectedAgent: null, hero: { dialMW: null, evidenceOpen: false, decision: null, offeredMW: null } });
      const scenario = SCENARIO_KEYS[e.key];
      if (scenario) {
        sim.applyScenario(scenario);
        useSim.setState({ study: null });
        resetUi();
        if (director) dir.load(scenario, 0);
        return;
      }
      switch (e.key.toLowerCase()) {
        case 'arrowleft':
        case 'arrowright': {
          if (director) {
            const next = dir.beat + (e.key === 'ArrowRight' ? 1 : -1);
            if (next >= 0) dir.go(next);
            break;
          }
          const step = e.key === 'ArrowRight' ? 0.25 : -0.25;
          s.setHours(Math.min(23.99, Math.max(0, Math.round((s.hours + step) * 4) / 4)));
          break;
        }
        case 'r':
          sim.applyScenario(sim.inputs.scenario);
          useSim.setState({ study: null });
          resetUi();
          if (director) dir.load(sim.inputs.scenario, 0);
          break;
        case 'n':
          ui.set({ narrationOn: !ui.narrationOn });
          break;
        case 'd':
          if (director) dir.set({ mode: 'explore', playing: false });
          else dir.set({ mode: 'director', script: sim.inputs.scenario, beat: 0, seq: dir.seq + 1, elapsed: 0, playing: false });
          break;
        case '`':
          s.toggleDebug();
          break;
        case 'escape':
          ui.set({ notesOpen: false, auditOpen: false, governanceOpen: false, feedOpen: false, selectedBranch: null, selectedAgent: null });
          break;
        case 't':
          s.toggleTheme();
          break;
        case 'f':
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen();
          break;
        case ' ':
          e.preventDefault();
          if (director) dir.set({ playing: !dir.playing });
          else s.setTimeRate(s.timeRate === 0 ? 0.8 : 0);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
