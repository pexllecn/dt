/** One generated test per rule: it fires on each of its firing examples and stays quiet on each quiet one. */
import { describe, expect, it } from 'vitest';
import { ALL_RULES, ruleCount, ruleSetHash } from '../../src/agents/agents.ts';
import { NOMINAL_TX } from '../../src/agents/rules/transformer.ts';
import { NOMINAL_BATTERY, NOMINAL_BUS, NOMINAL_DEMAND, NOMINAL_GAS, NOMINAL_INFEED, NOMINAL_TIE, NOMINAL_WIND } from '../../src/agents/rules/assets.ts';
import type { AnyRule } from '../../src/agents/types.ts';

const NOMINAL: Record<string, object> = {
  TX_BASE: NOMINAL_TX, TX_EXTENDED: NOMINAL_TX, BUS_RULES: NOMINAL_BUS, WIND_RULES: NOMINAL_WIND, BATTERY_RULES: NOMINAL_BATTERY,
  GAS_RULES: NOMINAL_GAS, DEMAND_RULES: NOMINAL_DEMAND, TIE_RULES: NOMINAL_TIE, INFEED_RULES: NOMINAL_INFEED,
};

for (const [set, rules] of Object.entries(ALL_RULES) as [string, readonly AnyRule[]][]) {
  describe(set, () => {
    for (const rule of rules) {
      it(`${rule.id}: ${rule.description}`, () => {
        expect(rule.examples.fires.length).toBeGreaterThan(0);
        expect(rule.examples.quiet.length).toBeGreaterThan(0);
        for (const ex of rule.examples.fires) expect(rule.condition({ ...NOMINAL[set], ...ex }, rule.threshold.value), `fires ${JSON.stringify(ex)}`).toBe(true);
        for (const ex of rule.examples.quiet) expect(rule.condition({ ...NOMINAL[set], ...ex }, rule.threshold.value), `quiet ${JSON.stringify(ex)}`).toBe(false);
        expect(rule.condition(NOMINAL[set], rule.threshold.value), 'quiet on the nominal input').toBe(false);
        for (const k of rule.inputs) expect(k in NOMINAL[set]!, `input ${k}`).toBe(true);
        expect(Object.isFrozen(rule)).toBe(true);
        expect(rule.threshold.source).toMatch(/Typical value|Assumption/);
      });
    }
  });
}

describe('rule sets', () => {
  it('have unique ids, 5 base and 30 extended transformer rules', () => {
    const ids = Object.values(ALL_RULES).flat().map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ALL_RULES.TX_BASE.length).toBe(5);
    expect(ALL_RULES.TX_EXTENDED.length).toBe(30);
  });
  it('hash stably, and differently for base and extended', () => {
    expect(ruleSetHash('extended')).toBe(ruleSetHash('extended'));
    expect(ruleSetHash('base')).not.toBe(ruleSetHash('extended'));
    expect(ruleCount('extended') - ruleCount('base')).toBe(30);
  });
});
