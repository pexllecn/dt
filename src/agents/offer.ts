import type { StudyBundle } from '@/sim/studies';
import { firmness } from '@/sim/studies';
import { allRules } from './rules';
import type { TraceEntry } from './types';

/** Asset-condition inputs: findings on these become conditions precedent on an offer. */
const CONDITION_INPUTS = new Set([
  'vegetationSurveyMonths',
  'thermographyHotspotC',
  'insulatorDefects',
  'towerCorrosionGrade',
  'faults12m',
  'oilDgaC2H2',
  'c2h2',
  'c2h2Rate',
]);

export interface OfferCondition {
  kind: 'precedent' | 'operational' | 'non-firm';
  text: string;
  /** Rule or method the condition comes from. */
  basis: string;
  asset?: string;
}

export interface Offer {
  requestedMW: number;
  offeredMW: number;
  firmMW: number;
  nonFirmMW: number;
  /** Share of the year (weighted studied intervals) in which the offered level is firm. */
  firmShare: number;
  curtailedMWhYear: number;
  /** Level above which the first constraint binds, and that constraint. */
  limitMW: number;
  limitConstraint: string | null;
  mainFeedMinMW: number;
  conditions: OfferCondition[];
}

/**
 * Turn the connection studies and the agents' findings into a conditional offer (METHOD-OFFER-01).
 * - Firm: the level that is firm in every interval of the secure studies, up to the level offered.
 * - Non-firm: the rest, with its availability and expected curtailment.
 * - Operational: with the main feed out, demand above the level that study supports is interruptible.
 * - Precedent: asset-condition findings by agents on circuits that carry the new demand must be
 *   resolved before energisation.
 */
export function deriveOffer(bundle: StudyBundle, offeredMW: number, trace: TraceEntry[]): Offer {
  const firmMW = Math.min(offeredMW, bundle.firmAllMW);
  const f = firmness(bundle, offeredMW);
  const mainFeed = bundle.studies.find((s) => s.id === 'mainfeed');
  const mainFeedMinMW = mainFeed ? Math.min(...mainFeed.firmMW) : bundle.requestMW;
  const conditions: OfferCondition[] = [];

  const affected = new Set(bundle.affected.map((a) => a.id));
  const ruleById = new Map(allRules.map((r) => [r.id, r]));
  const seen = new Set<string>();
  for (const t of trace) {
    if (t.event !== 'fired' || !t.ref || !affected.has(t.ref)) continue;
    const rule = ruleById.get(t.ruleId);
    if (!rule || !rule.inputs.some((i) => CONDITION_INPUTS.has(i))) continue;
    const key = `${t.ref}|${t.ruleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    conditions.push({
      kind: 'precedent',
      text: `${t.agentName}: ${t.ruleText.replace(/\.$/, '')}. Resolve before energisation.`,
      basis: `${t.ruleId} v${t.ruleVersion}`,
      asset: t.agentName,
    });
  }

  if (mainFeedMinMW < offeredMW) {
    conditions.push({
      kind: 'operational',
      text: `During outages of ${bundle.mainFeed.label}, demand above ${Math.floor(mainFeedMinMW)} MW is interruptible on instruction.`,
      basis: 'METHOD-FIRM-01, main feed out study',
    });
  }
  if (firmMW < offeredMW) {
    conditions.push({
      kind: 'non-firm',
      text: `${Math.round(offeredMW - firmMW)} MW is non-firm: available in ${Math.round(f.share * 100)}% of the year, with about ${Math.round(f.curtailedMWhYear)} MWh curtailed a year.`,
      basis: 'METHOD-FIRM-01',
    });
  }

  return {
    requestedMW: bundle.requestedMW,
    offeredMW,
    firmMW,
    nonFirmMW: Math.max(0, offeredMW - firmMW),
    firmShare: f.share,
    curtailedMWhYear: f.curtailedMWhYear,
    limitMW: bundle.firmAllMW,
    limitConstraint: bundle.topConstraint >= 0 ? bundle.constraints[bundle.topConstraint]!.label : null,
    mainFeedMinMW,
    conditions,
  };
}
