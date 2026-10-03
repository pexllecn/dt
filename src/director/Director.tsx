import { useEffect, useRef, useState } from 'react';
import { useWorld } from '@/app/store';
import { useSim } from '@/sim/client';
import { flyTo, stopCamera } from './camera';
import { beatText, scripts } from './scripts';
import { useDirector } from './store';

/**
 * Runs the current script in Director mode: on each beat it sets the clock, runs the beat's setup
 * and flies the camera; while playing it runs the clock to the beat's end time, holds, waits for
 * a person where the beat needs one, and moves on.
 */
const clock = { seq: -1, elapsed: 0 };

export function DirectorRuntime() {
  const mode = useDirector((s) => s.mode);
  const script = useDirector((s) => s.script);
  const beat = useDirector((s) => s.beat);
  const seq = useDirector((s) => s.seq);
  const worldReady = useWorld((s) => s.ready);
  // Beats read model data (stations, buses), so wait for the simulation as well as the world.
  const simReady = useSim((s) => !!s.meta && !!s.day);
  const ready = worldReady && simReady;
  const timers = useRef<number[]>([]);
  const startHours = useRef(0);

  // Enter a beat.
  useEffect(() => {
    if (mode !== 'director' || !ready) return;
    const b = scripts[script].beats[beat];
    if (!b) return;
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    const later = (ms: number, fn: () => void) => void timers.current.push(window.setTimeout(fn, ms));
    const w = useWorld.getState();
    w.setTimeRate(0);
    if (b.hours !== undefined) w.setHours(b.hours);
    startHours.current = useWorld.getState().hours;
    b.enter?.(later);
    // Shots that depend on simulation results retry until the results arrive.
    let tries = 0;
    const frame = () => {
      const shot = typeof b.shot === 'function' ? b.shot() : b.shot;
      if (shot) void flyTo(shot, b.fly ?? 4);
      else if (tries++ < 40) later(300, frame);
    };
    frame();
    return () => {
      timers.current.forEach((t) => clearTimeout(t));
      timers.current = [];
    };
  }, [mode, script, beat, seq, ready]);

  useEffect(() => () => stopCamera(), []);

  // Play: run the clock, hold, wait, advance.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      // Clamp: a clock change (or a long pause) must never run the beat clock backwards.
      const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
      last = now;
      const d = useDirector.getState();
      if (d.mode !== 'director' || !d.playing || !useWorld.getState().ready) return;
      const sc = scripts[d.script];
      const b = sc.beats[d.beat];
      if (!b) return;
      // The beat clock lives outside React state: writing it every frame would re-render.
      if (clock.seq !== d.seq) {
        clock.seq = d.seq;
        clock.elapsed = 0;
      }
      clock.elapsed += dt;
      const elapsed = clock.elapsed;
      if (b.timeTo !== undefined) {
        const f = Math.min(1, elapsed / b.hold);
        useWorld.getState().setHours(startHours.current + (b.timeTo - startHours.current) * f);
      }
      if (elapsed < b.hold) return;
      if (b.waitFor && !b.waitFor()) {
        if (!d.waiting) useDirector.setState({ waiting: true });
        return;
      }
      if (d.beat + 1 < sc.beats.length) d.go(d.beat + 1);
      else useDirector.setState({ playing: false, waiting: false });
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  return null;
}

/** Lower third: script title, beat caption, progress and the presenter's keys. */
export function DirectorBar() {
  const mode = useDirector((s) => s.mode);
  const script = useDirector((s) => s.script);
  const beat = useDirector((s) => s.beat);
  const playing = useDirector((s) => s.playing);
  const go = useDirector((s) => s.go);
  const d = { mode, script, beat, playing, go };
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  if (d.mode !== 'director') return null;
  const sc = scripts[d.script];
  const b = sc.beats[d.beat];
  if (!b) return null;
  const waitingOnPerson = !!b.waitFor && !b.waitFor();
  return (
    <div className="halo pointer-events-none absolute bottom-[196px] left-1/2 z-30 w-[760px] -translate-x-1/2 select-none text-center" aria-live="polite">
      <p className="text-[10px] uppercase tracking-[0.2em] text-ink-soft">
        {sc.title} · {d.beat + 1} of {sc.beats.length} · {b.title}
      </p>
      <p className="caption mt-2 text-[22px] leading-snug text-ink">{beatText(b.caption)}</p>
      <div className="pointer-events-auto mt-3 flex items-center justify-center gap-1.5">
        {sc.beats.map((x, i) => (
          <button
            key={x.id}
            title={x.title}
            aria-label={`Beat ${i + 1}: ${x.title}`}
            onClick={() => d.go(i)}
            className={`h-[3px] w-6 ${i === d.beat ? 'bg-ink' : i < d.beat ? 'bg-ink-soft' : 'bg-[var(--hairline)]'}`}
          />
        ))}
      </div>
      <p className="figure mt-2 text-[10px] text-ink-faint">
        {waitingOnPerson && d.playing ? 'waiting for a decision · ' : ''}
        {d.playing ? 'space pause' : 'space play'} · ← → beats · 1 to 4 scenarios · D explore
      </p>
    </div>
  );
}
