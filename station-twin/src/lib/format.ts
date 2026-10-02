/** British English formatting helpers. Figures always use tabular digits in the UI font. */
export const mw = (v: number, digits = 0): string => `${v.toFixed(digits)} MW`;
export const pct = (v: number, digits = 0): string => `${v.toFixed(digits)}%`;
export const degC = (v: number, digits = 0): string => `${v.toFixed(digits)} °C`;
export const hz = (v: number): string => `${v.toFixed(2)} Hz`;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Simulated date and time, for example "Tue 10 Mar 17:42". `epochMs` is the simulation day start (UTC). */
export function clockLabel(epochMs: number, t: number): string {
  const d = new Date(epochMs + Math.floor(t) * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hh}:${mm}`;
}

/** Compression label, for example "1 s = 2 min". */
export function compressionLabel(factor: number): string {
  if (factor < 60) return `1 s = ${factor} s`;
  if (factor < 3600) return `1 s = ${+(factor / 60).toFixed(1)} min`;
  return `1 s = ${+(factor / 3600).toFixed(1)} h`;
}
