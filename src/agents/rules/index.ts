import { lineRules } from './line';
import { transformerRules } from './transformer';
import { batteryRules, coordinatorRules, interconnectorRules, largeLoadRules, substationRules, windRules } from './other';
import type { AssetType, Rule } from '../types';

/** The frozen rule set. Its version and content hash are shown and logged with every decision. */
export const RULESET_VERSION = '1.0.0';

export const ruleSets: Record<AssetType, Rule<never>[]> = {
  line: lineRules as unknown as Rule<never>[],
  transformer: transformerRules as unknown as Rule<never>[],
  substation: substationRules as unknown as Rule<never>[],
  windfarm: windRules as unknown as Rule<never>[],
  battery: batteryRules as unknown as Rule<never>[],
  largeload: largeLoadRules as unknown as Rule<never>[],
  interconnector: interconnectorRules as unknown as Rule<never>[],
  coordinator: coordinatorRules as unknown as Rule<never>[],
};

export const allRules = Object.values(ruleSets).flat();

/** Short content hash of the rule set (ids, versions, text, thresholds) for the audit trail. */
export function ruleSetHash(): string {
  const text = allRules
    .map((r) => `${r.id}|${r.version}|${r.description}|${r.threshold.op}${r.threshold.value}${r.threshold.unit}|${r.severity}`)
    .join('\n');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}
