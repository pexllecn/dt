import { Twin } from '../../src/agents/twin.ts';
const fmt = (t: number) => `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;
function run(name: string, setup: (tw: Twin) => void, minutes: number) {
  const tw = new Twin();
  tw.wall = () => 'wall';
  const t0 = performance.now();
  setup(tw);
  tw.advance(minutes * 60);
  const v = tw.view();
  console.log(`\n=== ${name} (${(performance.now() - t0).toFixed(0)} ms) ===`);
  for (const e of v.feed.slice(-14)) console.log(fmt(e.t), e.agent.padEnd(7), e.ruleId.padEnd(18), e.outcome.padEnd(9), e.narration.slice(0, 150));
  for (const r of v.recommendations.slice(-2)) {
    console.log('REC', r.id, r.status, fmt(r.createdT), r.trigger.slice(0, 100), '| base', r.baseline.security, r.baseline.peakHotSpot.toFixed(1));
    for (const o of r.options) console.log('   ', o.rank, o.label.padEnd(60), o.outcome.security, o.outcome.peakHotSpot.toFixed(1), o.outcome.customerMWh.toFixed(0));
  }
  if (v.earlyCatch) console.log('EARLY', JSON.stringify(v.earlyCatch));
  return tw;
}
run('peak', (tw) => { tw.command({ type: 'fastForward', to: 17 * 3600 }); tw.runUntil(17 * 3600); tw.command({ type: 'scenario', id: 'peak' }); }, 40);
run('n1', (tw) => tw.command({ type: 'scenario', id: 'n1' }), 20);
run('cool_fail', (tw) => tw.command({ type: 'scenario', id: 'cool_fail' }), 70);
run('storm', (tw) => tw.command({ type: 'scenario', id: 'storm' }), 60);
run('split', (tw) => tw.command({ type: 'scenario', id: 'split' }), 10);
run('busfault', (tw) => tw.command({ type: 'scenario', id: 'busfault' }), 10);
run('ie_estate', (tw) => tw.command({ type: 'scenario', id: 'ie_estate' }), 5);
