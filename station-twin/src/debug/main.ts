/**
 * Simulation console: a plain page to drive and inspect the engine during development.
 * It is not the demo. It proves the worker, the protocol and the single-file build.
 */
import './style.css';
import { assumptionTable, CLOCK, SITE } from '../config/assumptions.ts';
import { clockLabel, compressionLabel } from '../lib/format.ts';
import type { Command, CommandResult } from '../sim/engine.ts';
import type { FromWorker, ToWorker } from '../sim/protocol.ts';
import { SCENARIOS } from '../sim/scenarios.ts';
import type { ComponentId, SimState } from '../sim/types.ts';
import SimWorker from '../sim/worker.ts?worker&inline';

const worker = new SimWorker();
const send = (m: ToWorker) => worker.postMessage(m);
let state: SimState | null = null;
let selected: ComponentId | null = null;
let nextId = 1;
const pending = new Map<number, (r: CommandResult) => void>();

function command(cmd: Command): Promise<CommandResult> {
  const id = nextId++;
  send({ type: 'command', id, cmd });
  return new Promise((res) => pending.set(id, res));
}

const app = document.getElementById('app')!;
app.innerHTML = `
<header>
  <h1>Clonmore (fictional) simulation console</h1>
  <span id="clock" class="pill num"></span>
  <button id="pause"></button>
  <select id="comp">${CLOCK.compressions.value.map((c) => `<option value="${c}">${compressionLabel(c)}</option>`).join('')}</select>
  <span id="cond" class="pill"></span>
  <span id="imp" class="num"></span>
  <span id="n1" class="num"></span>
  <span id="freq" class="num"></span>
</header>
<main>
  <section><h2>Scenarios</h2><div id="scn"></div></section>
  <section>
    <h2>Components</h2><div class="wrap"><table id="comps"></table></div>
    <h3>Supply</h3><div id="sup" class="num"></div>
    <h3>Demand</h3><div id="dem" class="num"></div>
    <h3>Frequency events</h3><div id="fev" class="num"></div>
  </section>
  <section>
    <h2>Selected</h2><div id="sel">Click a row to select a component.</div>
    <h2 style="margin-top:16px">Log</h2><div id="log" class="log"></div>
    <h2 style="margin-top:16px">Method and assumptions</h2>
    <details><summary>${assumptionTable().length} entries</summary><div class="wrap"><table>${assumptionTable().map((r) => `<tr><td>${r.label}</td><td class="n">${r.value} ${r.unit}</td><td>${r.source}</td></tr>`).join('')}</table></div></details>
  </section>
</main>
<div id="toast" class="toast" hidden></div>`;

const $ = (id: string) => document.getElementById(id)!;
let lastGroup = '';
$('scn').innerHTML = SCENARIOS.map((s) => {
  const g = s.group !== lastGroup ? `<h3>${s.group}</h3>` : '';
  lastGroup = s.group;
  return `${g}<button class="scn" data-s="${s.id}">${s.title}<small>${s.description}</small></button>`;
}).join('');
$('scn').addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest('[data-s]') as HTMLElement | null;
  if (b) showResult(await command({ type: 'scenario', id: b.dataset.s as never }));
});
$('pause').addEventListener('click', () => state && send({ type: 'clock', paused: !(window as unknown as { paused?: boolean }).paused }));
$('comp').addEventListener('change', (e) => send({ type: 'clock', compression: Number((e.target as HTMLSelectElement).value) }));
($('comp') as HTMLSelectElement).value = String(CLOCK.defaultCompression.value);
$('comps').addEventListener('click', (e) => {
  const tr = (e.target as HTMLElement).closest('tr[data-id]') as HTMLElement | null;
  if (tr) { selected = tr.dataset.id as ComponentId; render(); }
});

let toastTimer = 0;
function showResult(r: CommandResult): void {
  const t = $('toast');
  t.hidden = false;
  t.innerHTML = `<div class="t">${r.ok ? r.title : 'Not possible'}</div><div>${r.ok ? r.detail : r.reason ?? ''}</div>
    <div class="chips num">${r.deltas.map((d) => `<span>${d.label} ${d.before.toFixed(d.digits)} to ${d.after.toFixed(d.digits)} ${d.unit}</span>`).join('')}${r.settling ? '<span>when settled</span>' : ''}</div>`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 7000);
}

function renderSelected(s: SimState): void {
  if (!selected) return;
  const c = s.C[selected];
  const rows: string[] = [`<b>${c.name}</b> <span class="dead">${c.kv}</span>`, `<div class="dead">${c.note}</div>`];
  rows.push(`<div class="num">${c.tripped ? `<span class="trip">Tripped: ${c.tripCause}</span>` : c.installed ? (c.closed ? 'Breaker closed' : 'Breaker open') : 'Not built'}${c.bay ? `, disconnectors ${c.bay.dsBus && c.bay.dsLine ? 'closed' : 'open'}${c.bay.es ? ', earthed' : ''}` : ''}</div>`);
  if (c.kind === 'tx') rows.push(`<div class="num">Hot-spot ${c.temp.toFixed(1)} °C, top-oil ${c.topOil.toFixed(1)} °C, cooling stage ${c.stage}${c.cool ? ' (forced)' : ''}${c.pumpFailed ? ', pumps failed' : ''}, ageing ${c.ageingRate.toFixed(2)}×</div>`);
  const btns: string[] = [];
  if (c.installed && c.kind !== 'bus') {
    btns.push(`<button data-c='${JSON.stringify({ type: 'operate', id: c.id, device: 'cb', action: c.closed ? 'open' : 'close' })}'>${c.closed ? 'Open' : 'Close'} breaker</button>`);
    btns.push(`<button data-c='${JSON.stringify({ type: 'programme', id: c.id, programme: 'outOfService' })}'>Take out of service</button>`);
    btns.push(`<button data-c='${JSON.stringify({ type: 'programme', id: c.id, programme: 'returnToService' })}'>Return to service</button>`);
  }
  if (c.tripped) btns.push(`<button data-confirm="1" data-c='${JSON.stringify({ type: 'resetProtection', id: c.id, confirmed: true })}'>Confirm inspected, reset protection</button>`);
  if (c.kind === 'tx') btns.push(`<button data-c='${JSON.stringify({ type: 'forceCooling', id: c.id, on: !c.cool })}'>${c.cool ? 'Automatic cooling' : 'Force all cooling on'}</button>`);
  if (c.id === 'BESS' && c.installed) for (const mw of [-100, -50, 0, 50, 80, 100]) btns.push(`<button data-c='${JSON.stringify({ type: 'setBattery', mw })}'>${mw} MW</button>`);
  if (c.id === 'GAS' && c.installed) for (const out of [0, 90, 180]) btns.push(`<button data-c='${JSON.stringify({ type: 'setGeneration', id: 'GAS', out })}'>${out} MW</button>`);
  if (c.id === 'LD_TOWN') for (const mw of [0, 40, 80, 120]) btns.push(`<button data-c='${JSON.stringify({ type: 'shed', mw })}'>Shed ${mw} MW</button>`);
  if ((c.id === 'BUS220B' || c.id === 'BUS220A') && s.sys.busFault.includes(c.section!)) btns.push(`<button data-confirm="1" data-c='${JSON.stringify({ type: 'clearBusFault', section: c.section, confirmed: true })}'>Confirm fault clear, re-energise</button>`);
  if (!c.installed) btns.push(`<button data-c='${JSON.stringify({ type: 'build', id: c.id })}'>Build</button>`);
  rows.push(`<div class="controls" style="margin-top:8px">${btns.join('')}</div>`);
  $('sel').innerHTML = rows.join('');
}
$('sel').addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest('[data-c]') as HTMLElement | null;
  if (!b) return;
  if (b.dataset.confirm && !window.confirm('Confirm that the cause has been inspected and cleared?')) return;
  showResult(await command(JSON.parse(b.dataset.c!) as Command));
});

function render(): void {
  const s = state;
  if (!s) return;
  const C = s.C;
  $('clock').textContent = clockLabel(SITE.epochUtcMs.value, s.t);
  const cond = $('cond');
  cond.textContent = s.condition;
  cond.className = `pill cond-${s.condition}`;
  const g = s.results.gridFlow;
  $('imp').textContent = `${g >= 0 ? 'Import' : 'Export'} ${Math.abs(g).toFixed(0)} MW`;
  $('n1').textContent = s.contingency.lossOfT1 === null ? 'N-1 not applicable' : `N-1 ${(s.contingency.worst * 100).toFixed(0)}%${s.contingency.secure ? '' : ' (insecure)'}`;
  $('freq').textContent = s.frequency.coupled ? `${s.frequency.ireland.toFixed(3)} Hz` : `Ireland ${s.frequency.ireland.toFixed(3)} Hz, NI ${s.frequency.ni.toFixed(3)} Hz`;
  const ids = Object.keys(C) as ComponentId[];
  $('comps').innerHTML = `<tr><th>Component</th><th>State</th><th>MW</th><th>Dir</th><th>Load</th><th>Hot-spot</th></tr>` + ids.map((id) => {
    const c = C[id];
    const st = !c.installed ? 'not built' : c.tripped ? 'TRIPPED' : !c.closed ? 'open' : c.live ? 'live' : 'dead';
    const cls = c.tripped ? 'trip' : c.live && c.installed ? '' : 'dead';
    const tx = c.kind === 'tx';
    return `<tr data-id="${id}" class="${id === selected ? 'sel' : ''} ${cls}"><td>${c.name}</td><td>${st}</td><td class="n">${c.mwNow.toFixed(0)}</td><td class="n">${c.dir > 0 ? 'in' : c.dir < 0 ? 'out' : ''}</td><td class="n">${tx ? `${(c.loadPU * 100).toFixed(0)}%` : ''}</td><td class="n">${tx ? `${c.temp.toFixed(1)} °C` : ''}</td></tr>`;
  }).join('');
  $('sup').innerHTML = s.results.parts.sup.map((p) => `${p.label} ${p.mw.toFixed(0)} MW`).join(' · ');
  $('dem').innerHTML = s.results.parts.dem.map((p) => `${p.label} ${p.mw.toFixed(0)} MW`).join(' · ');
  $('fev').innerHTML = s.frequency.events.slice().reverse().map((ev) => `${clockLabel(SITE.epochUtcMs.value, ev.t)} ${ev.area}: ${ev.deltaMw > 0 ? 'deficit' : 'surplus'} ${Math.abs(ev.deltaMw).toFixed(0)} MW, RoCoF ${ev.rocof.toFixed(2)} Hz/s, nadir ${ev.nadir.toFixed(2)} Hz (${ev.cause})`).join('<br>') || 'None';
  $('log').innerHTML = s.log.slice().reverse().map((l) => `<div><span class="num dead">${clockLabel(SITE.epochUtcMs.value, l.t).slice(-5)}</span> ${l.text}</div>`).join('');
  renderSelected(s);
}

worker.onmessage = (ev: MessageEvent<FromWorker>) => {
  const m = ev.data;
  if (m.type === 'snapshot') {
    state = m.state;
    (window as unknown as { paused?: boolean }).paused = m.clock.paused;
    $('pause').textContent = m.clock.paused ? 'Play' : 'Pause';
    $('clock').title = compressionLabel(m.clock.effective);
    document.body.dataset.ready = '1';
    render();
  } else {
    pending.get(m.id)?.(m.result);
    pending.delete(m.id);
  }
};
