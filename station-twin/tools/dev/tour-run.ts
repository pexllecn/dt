import { Twin } from '../../src/agents/twin.ts';
import { BEATS, TourRunner } from '../../src/tour/tour.ts';
const hh = (t: number) => `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;
const t0 = performance.now();
const { twin: tw, runner } = TourRunner.at(0, () => new Twin(), () => 'w');
for (let i = 0; i < 40; i++) {
  const st = runner.status(tw);
  const s = tw.s;
  console.log(`${hh(s.t)} beat ${st.beat} ${st.id.padEnd(9)} ${String(st.awaiting).padEnd(7)} grid ${s.results.gridFlow.toFixed(0).padStart(5)} T1 ${s.C.T1.loadPU.toFixed(2)}${s.C.T1.tripped ? 'X' : ' '} T2 ${s.C.T2.loadPU.toFixed(2)}${s.C.T2.tripped ? 'X' : ' '} ${s.C.T2.temp.toFixed(0)}C wind ${s.C.WIND.actual.toFixed(0)} ${s.condition.padEnd(9)} | ${st.nextAction.slice(0, 80)}`);
  if (st.summary) console.log('SUMMARY', JSON.stringify(st.summary));
  const r = runner.next(tw);
  if (r === 'end') break;
}
console.log('audit', tw.view().audit.map((a) => `${hh(a.simT)} ${a.operator} ${a.option}`).join(' | '));
console.log('ms', (performance.now() - t0).toFixed(0), BEATS.length);
