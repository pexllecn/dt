import { Twin } from '../../src/agents/twin.ts';
const tw = new Twin(); tw.wall = () => 'w';
const hh = (t: number) => `${String(Math.floor(t / 3600) % 24).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}`;
const st = () => { const s = tw.s; return `${hh(s.t)} grid ${s.results.gridFlow.toFixed(0)} wind ${s.C.WIND.actual.toFixed(0)} solar ${s.C.SOLAR.actual.toFixed(0)} bess ${s.C.BESS.actual.toFixed(0)} soc ${s.C.BESS.soc.toFixed(0)} town ${s.C.LD_TOWN.actual.toFixed(0)} tieN ${s.C.TIE_N.actual.toFixed(0)} T1 ${s.C.T1.loadPU.toFixed(2)} ${s.C.T1.tripped} T2 ${s.C.T2.loadPU.toFixed(2)} ${s.C.T2.tripped} ${s.condition} pend ${tw.view().recommendations.filter(r=>r.status==='pending').map(r=>r.id+':'+r.options[0]?.label).join(';')}`; };
let t0 = performance.now();
tw.command({ type: 'fastForward', to: 7 * 3600 + 40 * 60 }); tw.runUntil(7 * 3600 + 40 * 60);
console.log(st(), (performance.now()-t0).toFixed(0));
for (const id of ['add_solar', 'add_bess', 'wind_up', 'imp_n'] as const) tw.command({ type: 'scenario', id });
tw.command({ type: 'setBattery', mw: 100 });
for (const h of [10, 11, 12, 12.5, 13]) { tw.runUntil(h * 3600); console.log(st()); }
console.log('ms', (performance.now()-t0).toFixed(0));
