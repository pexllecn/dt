/**
 * Every figure the twin shows carries its provenance. Config modules only accept
 * Sourced values, so a bare number cannot reach the UI without a label.
 */
export type SourceLabel = 'Public' | 'Synthetic' | 'Assumption' | 'Approximate';

export interface Sourced<T = number> {
  readonly value: T;
  readonly unit: string;
  readonly source: SourceLabel;
  /** Citation or basis, in plain English. */
  readonly ref?: string;
}

export function sourced<T>(value: T, unit: string, source: SourceLabel, ref?: string): Sourced<T> {
  return Object.freeze({ value, unit, source, ref });
}
