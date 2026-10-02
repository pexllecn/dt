/**
 * Switching with interlocks, protection lockout, and switching programmes.
 * Disconnectors must never make or break load current, so they move only with the breaker open;
 * earth switches close only on an isolated circuit. Every refusal explains itself.
 */
import type { ComponentId, Device, Programme, ProgrammeStep, SimState } from './types.ts';

export interface SwitchResult {
  ok: boolean;
  reason: string | null;
}

const DEVICE_NAMES: Record<Device, string> = {
  cb: 'circuit breaker', dsBus: 'busbar disconnector', dsLine: 'line disconnector', es: 'earth switch',
};

export function deviceName(d: Device): string {
  return DEVICE_NAMES[d];
}

export function operate(s: SimState, id: ComponentId, device: Device, action: 'open' | 'close'): SwitchResult {
  const c = s.C[id];
  const b = c.bay;
  const close = action === 'close';
  if (!c.installed) return { ok: false, reason: `${c.name} is not built.` };
  if (device === 'cb') {
    if (close) {
      if (c.tripped) return { ok: false, reason: `Protection on ${c.name} is locked out. Confirm the cause is cleared and reset it first.` };
      if (b && (!b.dsBus || !b.dsLine)) return { ok: false, reason: 'Close both disconnectors before the circuit breaker.' };
      if (b && b.es) return { ok: false, reason: 'Open the earth switch first.' };
      if (c.section && s.sys.busFault.includes(c.section)) return { ok: false, reason: `220 kV section ${c.section} is faulted and blocked from re-energisation.` };
    }
    c.closed = close;
    return { ok: true, reason: null };
  }
  if (!b) return { ok: false, reason: `${c.name} has no ${DEVICE_NAMES[device]}.` };
  if (device === 'es') {
    if (b.es === null) return { ok: false, reason: `${c.name} has no earth switch.` };
    if (close && (b.dsBus || b.dsLine)) return { ok: false, reason: 'Open both disconnectors before earthing the circuit.' };
    b.es = close;
    return { ok: true, reason: null };
  }
  if (c.closed) return { ok: false, reason: 'Open the circuit breaker first. Disconnectors must not make or break load current.' };
  if (close && b.es) return { ok: false, reason: 'Open the earth switch before closing a disconnector.' };
  b[device] = close;
  return { ok: true, reason: null };
}

export function outOfServiceSteps(s: SimState, id: ComponentId): ProgrammeStep[] {
  const c = s.C[id];
  const steps: ProgrammeStep[] = [];
  if (c.closed) steps.push({ id, device: 'cb', action: 'open' });
  if (c.bay?.dsLine) steps.push({ id, device: 'dsLine', action: 'open' });
  if (c.bay?.dsBus) steps.push({ id, device: 'dsBus', action: 'open' });
  if (c.bay && c.bay.es === false) steps.push({ id, device: 'es', action: 'close' });
  return steps;
}

export function returnToServiceSteps(s: SimState, id: ComponentId): ProgrammeStep[] {
  const c = s.C[id];
  const steps: ProgrammeStep[] = [];
  if (c.bay?.es) steps.push({ id, device: 'es', action: 'open' });
  if (c.bay && !c.bay.dsBus) steps.push({ id, device: 'dsBus', action: 'close' });
  if (c.bay && !c.bay.dsLine) steps.push({ id, device: 'dsLine', action: 'close' });
  if (!c.closed) steps.push({ id, device: 'cb', action: 'close' });
  return steps;
}

/** Simulated seconds between programme steps (operator confirmation and device travel). */
export const PROGRAMME_STEP_S = 20;

export function startProgramme(title: string, steps: ProgrammeStep[]): Programme {
  return { title, steps, next: 0, timer: 0, status: 'running', reason: null };
}

/** Advance a running programme; returns a log line when a step executes. */
export function programmeStep(s: SimState, dt: number): string | null {
  const p = s.programme;
  if (!p || p.status !== 'running') return null;
  p.timer += dt;
  if (p.timer < PROGRAMME_STEP_S) return null;
  p.timer = 0;
  const step = p.steps[p.next];
  if (!step) { p.status = 'done'; return `${p.title}: complete.`; }
  const r = operate(s, step.id, step.device, step.action);
  if (!r.ok) {
    p.status = 'aborted';
    p.reason = r.reason;
    return `${p.title}: stopped. ${r.reason}`;
  }
  p.next++;
  if (p.next >= p.steps.length) p.status = 'done';
  const verb = step.action === 'open' ? 'Opened' : 'Closed';
  return `${verb} ${s.C[step.id].name} ${DEVICE_NAMES[step.device]}.`;
}
