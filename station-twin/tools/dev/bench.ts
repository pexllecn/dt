import { Engine } from '../../src/sim/engine.ts';
const e = new Engine();
e.command({ type: 'scenario', id: 'peak' });
let t0 = performance.now();
e.advance(7200);
console.log('2h advance ms', (performance.now() - t0).toFixed(1));
t0 = performance.now();
for (let i = 0; i < 20; i++) { const c = structuredClone(e.s); void c; }
console.log('clone ms', ((performance.now() - t0) / 20).toFixed(2));
const e2 = new Engine();
e2.command({ type: 'scenario', id: 'cool_fail' });
const first: Record<string, number> = {};
for (let i = 0; i < 12 * 60 * 8; i++) { e2.step(); const c = e2.s.C.T1; if (c.temp > 110 && !first.b02) first.b02 = e2.s.t; if (c.topOil > 95 && !first.b03) first.b03 = e2.s.t; }
console.log('cool_fail', JSON.stringify(first), 'start', 12 * 3600, 'T1', e2.s.C.T1.temp.toFixed(1), e2.s.C.T1.topOil.toFixed(1), e2.s.C.T1.loadPU.toFixed(2), e2.s.C.T1.tripped);
