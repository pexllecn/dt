// Generates tests/parity/fixtures/prototype.json by executing the original prototype.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPrototype } from './prototype-harness.mjs';
import { CASES, CHECKPOINTS, FRAME_DT } from './cases.mjs';

const here = dirname(fileURLToPath(import.meta.url));

function apply(p, a) {
  if (a.scenario) p.runScenario(a.scenario);
  else if (a.set) p.get(`C[${JSON.stringify(a.set[0])}][${JSON.stringify(a.set[1])}] = ${JSON.stringify(a.set[2])}; solve(0.4);`);
  else if (a.setSys) p.get(`SYS[${JSON.stringify(a.setSys[0])}] = ${JSON.stringify(a.setSys[1])}; solve(0.4);`);
  else if (a.toggle) p.get(`UI.toggle(${JSON.stringify(a.toggle)}); solve(0.4);`);
  else if (a.autoBalance) p.get(`autoBalance(); solve(0.4);`);
  else if (a.clearFault) p.get(`SYS.busFault = false; C.BUS220.closed = true; solve(0.4);`);
  else if (a.recouple) p.get(`SYS.coupled = true; SYS.shock = 0.05; solve(0.4);`);
}

const out = { generatedFrom: 'reference/clonmore-prototype.html', frameDt: FRAME_DT, cases: {} };
for (const c of CASES) {
  const p = createPrototype();
  p.runScenario('reset');
  for (const a of c.actions) apply(p, a);
  const records = [];
  let t = 0;
  for (const cp of CHECKPOINTS) {
    while (t < cp - 1e-9) { p.frame(FRAME_DT); t += FRAME_DT; }
    records.push({ t: cp, ...p.snapshot() });
  }
  out.cases[c.name] = records;
}
writeFileSync(join(here, 'fixtures/prototype.json'), JSON.stringify(out));
console.log(`wrote ${Object.keys(out.cases).length} cases`);
