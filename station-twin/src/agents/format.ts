/** Number formatting for agent text (British English, no locale surprises). */
export function formatNum(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '-';
  return v.toFixed(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
