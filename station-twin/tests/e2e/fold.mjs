// The fold keeps selection and values: with the clock paused, the selected component, its
// inspector and every visible label value read the same before, during and after the fold, in
// both directions. Also checks the fold finishes within 2.5 s of simulated frame time.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = join(root, 'dist/index.html');
if (!existsSync(html)) { console.error('Run "npm run build" first.'); process.exit(1); }
const exe = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

const base = 'capture=1&backend=webgl&tier=low&dock=0&select=T1';
const points = [
  ['before', 'frames=2'],
  ['forward, 30%', 'lens=circuit&frames=20'],
  ['forward, 70%', 'lens=circuit&frames=46'],
  ['folded', 'lens=circuit&frames=67'],
  ['back, 40%', 'lens=circuit&frames=67&then=physical&thenFrames=40'],
  ['after', 'lens=circuit&frames=67&then=physical&thenFrames=67'],
];
const read = async (q) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(html).href + '?' + base + '&' + q);
  await page.waitForSelector('body[data-ready="1"]', { timeout: 300000, state: 'attached' });
  const r = await page.evaluate(() => {
    const s = window.__stage;
    const insp = document.querySelector('.insp')?.innerText ?? null;
    // Values of every label currently shown (decluttering can hide different ones at different moments).
    const labels = Object.fromEntries([...document.querySelectorAll('.lbl:not(.place)')].filter((e) => e.style.opacity === '1').map((e) => [e.querySelector('b')?.textContent, e.querySelector('span')?.textContent]));
    return { p: s.foldP(), selected: s.selected, insp, labels };
  });
  await page.close();
  return { ...r, errors };
};
const results = [];
for (const [name, q] of points) results.push({ name, ...(await read(q)) });
await browser.close();

const ref = results[0];
let ok = true;
for (const r of results) {
  const mismatched = Object.entries(r.labels).filter(([k, v]) => k in ref.labels && ref.labels[k] !== v);
  const same = r.selected === 'T1' && r.insp === ref.insp && r.insp !== null && 'T1' in r.labels && mismatched.length === 0 && r.errors.length === 0;
  if (!same) console.log(JSON.stringify({ insp: r.insp === ref.insp, labels: r.labels, mismatched }));
  console.log(`${same ? 'ok  ' : 'FAIL'} ${r.name.padEnd(14)} p=${r.p.toFixed(3)} selected=${r.selected}${r.errors.length ? ' errors=' + r.errors.join('; ') : ''}`);
  ok &&= same;
}
ok &&= results[3].p === 1 && results[5].p === 0;
if (!ok) { console.error('fold check failed'); process.exit(1); }
console.log('fold check passed');
