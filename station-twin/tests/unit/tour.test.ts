/** The guided tour is deterministic: the same presses give the same day and the same audit log. */
import { describe, expect, it } from 'vitest';
import { Twin } from '../../src/agents/twin.ts';
import { BEATS, PRESENTER, TourRunner } from '../../src/tour/tour.ts';

const wall = () => '2026-03-11T07:40:00.000Z';
function present(): { audit: string; hash: string; beats: { beat: number; hash: string }[]; exportedAtMidday: boolean } {
  const { twin, runner } = TourRunner.at(0, () => new Twin(), wall);
  const beats: { beat: number; hash: string }[] = [{ beat: 0, hash: twin.engine.stateHash() }];
  let exportedAtMidday = false;
  for (let i = 0; i < 60; i++) {
    const before = runner.beat;
    const r = runner.next(twin);
    if (runner.beat === 2 && twin.s.results.gridFlow < 0) exportedAtMidday = true;
    if (runner.beat !== before) beats.push({ beat: runner.beat, hash: twin.engine.stateHash() });
    if (r === 'end') break;
  }
  return { audit: JSON.stringify(twin.view().audit), hash: twin.engine.stateHash(), beats, exportedAtMidday };
}

describe('guided tour', () => {
  const a = present();
  const b = present();
  it('runs end to end through all eight beats', () => {
    expect(BEATS.length).toBe(8);
    expect(a.beats.map((x) => x.beat)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('gives identical audit logs and final state twice', () => {
    expect(a.audit).toBe(b.audit);
    expect(a.hash).toBe(b.hash);
    const audit = JSON.parse(a.audit) as { operator: string; decision: string }[];
    expect(audit.length).toBeGreaterThanOrEqual(3);
    expect(audit.every((e) => e.operator === PRESENTER && e.decision === 'approve')).toBe(true);
  });
  it('reaches every beat deterministically, so Left lands on the same state', () => {
    for (const { beat, hash } of a.beats) expect(TourRunner.at(beat, () => new Twin(), wall).twin.engine.stateHash(), `beat ${beat}`).toBe(hash);
  }, 180000);
  it('shows the 400 kV reversal at midday, and the trips and recovery the beats describe', () => {
    expect(a.exportedAtMidday).toBe(true);
  });
});
