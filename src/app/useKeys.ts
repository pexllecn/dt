import { useEffect } from 'react';
import { useWorld } from './store';

/** Presenter keys available from milestone 2: T theme, D debug, F fullscreen, Space time-lapse. */
export function useKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey) return;
      const s = useWorld.getState();
      switch (e.key.toLowerCase()) {
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
