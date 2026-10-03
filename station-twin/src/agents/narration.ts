/**
 * Narration: plain sentences built from the trace, fully offline. Labelled "Narration" in the UI
 * and never used to make a decision.
 */
import { formatNum } from './format.ts';
import type { AnyRule, Option, Recommendation, TraceEntry } from './types.ts';

const n = (v: unknown, d = 0) => (typeof v === 'number' ? formatNum(v, d) : String(v));

/** One sentence for a rule transition. */
export function narrateRule(agent: string, rule: AnyRule, e: TraceEntry): string {
  const i = e.inputs;
  if (e.outcome === 'cleared') return `${agent}: ${lower(rule.description)} No longer the case.`;
  switch (rule.id) {
    case 'TX-E-15': case 'TX-E-16':
      return `${agent} is running ${n(i.residualK, 1)} K hotter than its own thermal model expects for this load (top-oil ${n(i.topOil, 1)} °C against ${n(i.expectedTopOil, 1)} °C). Cooling may be degraded.`;
    case 'TX-E-17': return `${agent}'s top-oil has drifted further above its model for 15 minutes, now ${n(i.residualK, 1)} K.`;
    case 'TX-E-21': return `${agent} has all cooling running yet is ${n(i.residualK, 1)} K above its model: the cooling is not removing heat as it should.`;
    case 'TX-E-28': return `If ${agent === 'T1' ? 'T2' : 'T1'} were lost, ${agent} would carry ${n(Number(i.n1LoadPU) * 100)}% of its nameplate, beyond the normal cyclic limit. The station is not N-1 secure.`;
    case 'TX-E-10': return `${agent}'s hot-spot is forecast to reach 120 °C in ${n(i.minutesTo120)} minutes.`;
    case 'TX-B-02': return `${agent}'s winding temperature alarm: hot-spot ${n(i.hotSpot, 1)} °C.`;
    case 'TX-B-05': return `${agent} has tripped and is locked out.`;
    case 'WND-01': return `Wind is forecast to reach ${n(i.forecastMaxWind60, 1)} m/s within the hour; the turbines will ramp down towards cut-out.`;
    case 'TIE-01': return 'The border circuit has opened: Ireland and Northern Ireland are running as separate systems.';
    case 'BUS-02': return `${agent}: bus-zone protection operated, ${n(i.affectedCircuits)} circuits disconnected.`;
    case 'BUS-03': return `${agent} stays de-energised until a person confirms the fault is clear.`;
    case 'DEM-01': return `${agent}: ${n(i.offSupplyMW)} MW of demand off supply${Number(i.households) > 0 ? `, about ${n(i.households)} households` : ''}.`;
    default: {
      const vals = rule.inputs.slice(0, 2).map((k) => `${k} ${n(i[k], 2)}`).join(', ');
      return `${agent}: ${lower(rule.description)}${vals ? ` (${vals})` : ''}`;
    }
  }
}

export function narrateRecommendation(r: Recommendation): string {
  const best = r.options[0];
  if (!best) return `${r.trigger} No action found that improves on doing nothing.`;
  const sec = (o: Option) => (o.outcome.security === 'holds' ? 'holds every limit' : o.outcome.security === 'tolerable' ? 'stays within emergency limits' : 'does not hold limits');
  return `${r.trigger} Best option: ${lower(best.label)}, which ${sec(best)} over the next ${Math.round(r.horizonS / 60)} minutes, with a peak hot-spot of ${formatNum(best.outcome.peakHotSpot, 0)} °C. Doing nothing peaks at ${formatNum(r.baseline.peakHotSpot, 0)} °C.`;
}

const lower = (s: string) => (s.length > 1 && s[1] === s[1]!.toLowerCase() ? s[0]!.toLowerCase() + s.slice(1) : s);
