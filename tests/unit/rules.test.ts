import { describe, expect, it } from 'vitest';
import { allRules, ruleSetHash, ruleSets } from '@/agents/rules';
import { ageingRate, duval, hotSpot, topOil } from '@/agents/transformerModel';

/** Every rule is tested from its own examples: each "fires" example must fire, each "quiet" must not. */
describe('agent rules', () => {
  for (const rule of allRules) {
    it(`${rule.id}: ${rule.description}`, () => {
      for (const input of rule.examples.fires) expect(rule.condition(input as never, rule.threshold.value), 'should fire').toBe(true);
      for (const input of rule.examples.quiet) expect(rule.condition(input as never, rule.threshold.value), 'should stay quiet').toBe(false);
    });
  }

  it('has unique ids, frozen rules and readable British text without em dashes', () => {
    const ids = allRules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of allRules) {
      expect(Object.isFrozen(r)).toBe(true);
      expect(r.description).not.toMatch(/—/);
      expect(r.outcome).not.toMatch(/—/);
      expect(r.examples.fires.length).toBeGreaterThan(0);
      expect(r.examples.quiet.length).toBeGreaterThan(0);
    }
  });

  it('has a base set of about five rules per asset type and 30 or more extended rules for lines and transformers', () => {
    for (const [type, rules] of Object.entries(ruleSets)) {
      const baseCount = rules.filter((r) => r.maturity === 'base').length;
      expect(baseCount, type).toBeGreaterThanOrEqual(4);
      expect(baseCount, type).toBeLessThanOrEqual(6);
    }
    expect(ruleSets.line.filter((r) => r.maturity === 'extended').length).toBeGreaterThanOrEqual(30);
    expect(ruleSets.transformer.filter((r) => r.maturity === 'extended').length).toBeGreaterThanOrEqual(30);
  });

  it('has a stable content hash', () => {
    expect(ruleSetHash()).toMatch(/^[0-9a-f]{12}$/);
    expect(ruleSetHash()).toBe(ruleSetHash());
  });
});

describe('transformer model (IEC 60076-7, Duval triangle)', () => {
  it('reaches about the rated hot spot at full load and 20 °C ambient', () => {
    // Typical ONAF: 20 + 45 + 26 = 91 °C at K = 1
    expect(topOil(20, 1)).toBeCloseTo(65, 6);
    expect(hotSpot(20, 1)).toBeCloseTo(91, 6);
  });
  it('ages at the reference rate at 98 °C and doubles every 6 °C', () => {
    expect(ageingRate(98)).toBeCloseTo(1, 9);
    expect(ageingRate(104)).toBeCloseTo(2, 9);
  });
  it('classifies textbook gas ratios', () => {
    expect(duval(98.5, 1, 0.5)).toBe('PD');
    expect(duval(80, 15, 1)).toBe('T1');
    expect(duval(20, 75, 2)).toBe('T3');
    expect(duval(30, 15, 55)).toBe('D1');
  });
});
