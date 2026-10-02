/** Transformer protection and alarms (engineering preset). */
import { PROTECTION as P } from '../config/assumptions.ts';
import type { ComponentId, SimState, TransformerId } from './types.ts';
import { TRANSFORMERS } from './types.ts';

export function trip(s: SimState, id: ComponentId, cause: string): void {
  const c = s.C[id];
  if (c.tripped) return;
  c.closed = false;
  c.tripped = true;
  c.tripCause = cause;
  s.log.push({ t: s.t, kind: 'trip', id, text: `${c.name} tripped: ${cause}.` });
}

/** Evaluates alarms and trips; returns true if anything tripped. */
export function protectTransformers(s: SimState, dt: number): boolean {
  let tripped = false;
  for (const id of TRANSFORMERS as readonly TransformerId[]) {
    const c = s.C[id];
    if (!c.installed) continue;
    const wti = c.live && c.temp >= P.wtiAlarm.value;
    const oti = c.live && c.topOil >= P.otiAlarm.value;
    if (wti && !c.alarms.wti) s.log.push({ t: s.t, kind: 'alarm', id, text: `${c.name} winding temperature alarm (${c.temp.toFixed(0)} °C).` });
    if (oti && !c.alarms.oti) s.log.push({ t: s.t, kind: 'alarm', id, text: `${c.name} oil temperature alarm (${c.topOil.toFixed(0)} °C).` });
    c.alarms.wti = wti;
    c.alarms.oti = oti;
    if (!c.live || c.tripped) { c.ocTimer = 0; continue; }
    if (c.temp >= P.wtiTrip.value) { trip(s, id, 'winding temperature trip'); tripped = true; continue; }
    if (c.topOil >= P.otiTrip.value) { trip(s, id, 'oil temperature trip'); tripped = true; continue; }
    if (c.loadPU >= P.overcurrentPickup.value) {
      c.ocTimer += dt;
      if (c.ocTimer >= P.overcurrentDelayS.value) { trip(s, id, 'backup overcurrent'); tripped = true; }
    } else c.ocTimer = 0;
  }
  return tripped;
}
