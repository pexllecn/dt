/** Messages between the main thread and the simulation worker. The worker owns the truth. */
import type { Command, CommandResult } from './engine.ts';
import type { Preset, SimState } from './types.ts';

export interface ClockState {
  /** Simulated seconds per wall second chosen by the user. */
  compression: number;
  /** Rate actually applied (time-lapse while fast-forwarding). */
  effective: number;
  paused: boolean;
}

export type ToWorker =
  | { type: 'init'; preset: Preset; seed: number }
  | { type: 'command'; id: number; cmd: Command }
  | { type: 'clock'; compression?: number; paused?: boolean };

export type FromWorker =
  | { type: 'snapshot'; state: SimState; clock: ClockState; hash: string | null }
  | { type: 'result'; id: number; result: CommandResult };
