import { useWorld } from '@/app/store';
import { useSim } from '@/sim/client';
import { StatusPill, type PillState } from './StatusPill';
import { useUi } from './uiStore';
import { useTick } from './useTick';

/** Status pill driven by the simulation: comms loss and critical alarms outrank running or paused. */
export function SystemPill() {
  useTick(400);
  const timeRate = useWorld((s) => s.timeRate);
  const inputs = useSim((s) => s.inputs);
  const agents = useSim((s) => s.agents);
  const meta = useSim((s) => s.meta);
  const maturity = useUi((s) => s.maturity);
  const feedOpen = useUi((s) => s.feedOpen);
  const hours = useWorld.getState().hours;
  const step = Math.min(95, Math.floor(hours * 4));
  let critical = 0;
  if (agents && meta) {
    const nA = meta.agents.length;
    const lv = maturity === 'base' ? agents.levelBase : agents.level;
    for (let a = 0; a < nA; a++) if (lv[step * nA + a]! >= 4) critical++;
  }
  const out = inputs.timedOutages.filter((t) => hours >= t.fromHour).length + inputs.outages.length;
  let state: PillState;
  if (inputs.commsLostFromHour !== null && hours >= inputs.commsLostFromHour) state = { label: 'COMMS LOST · REGION W', tone: 'alert' };
  else if (critical > 0) state = { label: `${critical} CRITICAL ALARM${critical > 1 ? 'S' : ''} · ${out ? `${out} OUT · ` : ''}SIMULATION`, tone: 'alert' };
  else if (out > 0) state = { label: `${out} CIRCUIT${out > 1 ? 'S' : ''} OUT · SIMULATION`, tone: 'alert' };
  else state = timeRate !== 0 ? { label: 'SIMULATION · RUNNING', tone: 'running' } : { label: 'SIMULATION · PAUSED', tone: 'paused' };
  return <StatusPill state={state} offset={feedOpen ? 448 : 32} />;
}
