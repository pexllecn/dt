import { describe, expect, it } from 'vitest';
import { costUsd, houseStyle, keepsFacts } from '@/lib/narration';

describe('narration guard', () => {
  it('accepts a rephrasing that keeps the numbers', () => {
    expect(keepsFacts('Firm up to 116 MW in 96 intervals.', 'Up to 116 MW stays firm across all 96 intervals.')).toBe(true);
  });
  it('rejects a rephrasing that invents or changes a number', () => {
    expect(keepsFacts('Fifty megawatts is firm.', 'All 50 MW is firm.')).toBe(false);
    expect(keepsFacts('Loading reaches 116%.', 'Loading reaches 118%.')).toBe(false);
  });
  it('counts cost at the list price', () => {
    expect(costUsd(1_000_000, 0)).toBeCloseTo(4);
    expect(costUsd(0, 1_000_000)).toBeCloseTo(20);
  });
  it('removes dashes used as punctuation', () => {
    expect(houseStyle('A line — with a dash')).toBe('A line, with a dash');
  });
});
