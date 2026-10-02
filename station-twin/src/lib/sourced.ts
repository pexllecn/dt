/**
 * Every figure the twin relies on carries its provenance. The Method and assumptions panel
 * is generated from these records, so nothing on screen is an unlabelled number.
 */
export type SourceType = 'Typical value' | 'Assumption' | 'Simplification';

export interface Sourced<T = number> {
  readonly label: string;
  readonly value: T;
  readonly unit: string;
  readonly source: SourceType;
  /** Where the value comes from, e.g. 'IEC 60076-7' or 'Prototype value'. */
  readonly ref?: string;
  /** Plain-English note shown beside the value. */
  readonly note?: string;
}

export function sourced<T>(
  label: string,
  value: T,
  unit: string,
  source: SourceType,
  ref?: string,
  note?: string,
): Sourced<T> {
  return Object.freeze({ label, value, unit, source, ...(ref ? { ref } : {}), ...(note ? { note } : {}) });
}

export const typical = <T>(label: string, value: T, unit: string, ref?: string, note?: string) =>
  sourced(label, value, unit, 'Typical value', ref, note);
export const assumed = <T>(label: string, value: T, unit: string, ref?: string, note?: string) =>
  sourced(label, value, unit, 'Assumption', ref, note);
