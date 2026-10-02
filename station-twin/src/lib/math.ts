export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Sign with the prototype's 0.5 MW dead band. */
export const sgn = (v: number): -1 | 0 | 1 => (v > 0.5 ? 1 : v < -0.5 ? -1 : 0);

/** Move `current` towards `target` by at most `maxStep`. */
export function approach(current: number, target: number, maxStep: number): number {
  if (maxStep <= 0) return current;
  const d = target - current;
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

/** Fraction of the way a first-order lag moves in dt with time constant tau. */
export const lagFactor = (dt: number, tau: number): number => (tau <= 0 ? 1 : 1 - Math.exp(-dt / tau));
