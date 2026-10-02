/**
 * Demand shapes for non-data-centre load, as a fraction of the winter weekday peak.
 * Hourly points (00:00 .. 23:00), linearly interpolated at 15-minute resolution.
 * Shapes are synthetic but follow the familiar Irish pattern: night trough around 04:00,
 * morning ramp, daytime plateau, and a winter evening peak between 17:00 and 19:00.
 */
const winterWeekday = [
  0.6, 0.54, 0.51, 0.5, 0.5, 0.52, 0.58, 0.7, 0.82, 0.86, 0.87, 0.87, 0.86, 0.85, 0.84, 0.85, 0.9, 0.99, 1.0, 0.96, 0.9,
  0.83, 0.75, 0.67,
];
const summerWeekday = [
  0.55, 0.5, 0.47, 0.46, 0.46, 0.47, 0.52, 0.62, 0.72, 0.77, 0.8, 0.81, 0.82, 0.81, 0.8, 0.79, 0.79, 0.8, 0.8, 0.78, 0.76,
  0.74, 0.69, 0.61,
].map((v) => v * 0.8);
const weekendShift = (shape: number[]) =>
  shape.map((v, h) => {
    const morning = h >= 6 && h <= 10 ? 0.86 : 0.93;
    return v * morning;
  });

export type DayType = 'weekday' | 'weekend';

/** Season weight: 1 in deep winter, 0 in high summer (cosine through the year). */
export function winterWeight(month: number, day: number): number {
  const doy = (month - 1) * 30.4 + day;
  // Coldest around 15 January (doy 15), warmest around mid July.
  return 0.5 + 0.5 * Math.cos(((doy - 15) / 365) * 2 * Math.PI);
}

export function dayType(y: number, m: number, d: number): DayType {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 || wd === 6 ? 'weekend' : 'weekday';
}

/** Fraction of winter weekday peak for non-data-centre demand at local hour h. */
export function nonDcShape(hours: number, month: number, day: number, type: DayType): number {
  const w = winterWeight(month, day);
  let a = winterWeekday;
  let b = summerWeekday;
  if (type === 'weekend') {
    a = weekendShift(a);
    b = weekendShift(b);
  }
  const h = ((hours % 24) + 24) % 24;
  const i = Math.floor(h);
  const f = h - i;
  const j = (i + 1) % 24;
  const va = a[i]! * (1 - f) + a[j]! * f;
  const vb = b[i]! * (1 - f) + b[j]! * f;
  return vb + (va - vb) * w;
}

/** Data centre demand: near flat, a small daytime cooling swing. */
export function dcShape(hours: number, loadFactor: number): number {
  const swing = (1 - loadFactor) * 0.5;
  return loadFactor + swing * Math.sin(((hours - 9) / 24) * 2 * Math.PI);
}
