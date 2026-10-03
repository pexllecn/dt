// Every plant that can be built must appear when it is built after the scene has started
// (the solar farm, battery and campus once stayed culled). Builds each one live, photographs its
// site before and after, and requires a clear change in the middle of the picture.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = join(root, 'dist/index.html');
if (!existsSync(html)) { console.error('Run "npm run build" first.'); process.exit(1); }
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(html).href + '?capture=1&backend=webgl&tier=medium&dock=0&time=12:00');
await page.waitForSelector('body[data-ready="1"]', { timeout: 600000, state: 'attached' });
await page.addStyleTag({ content: '.ui { display: none !important; }' });

// Site centre (x, z) and viewing distance.
const SITES = { GAS: [-315, 195, 260], BESS: [200, -50, 200], SOLAR: [690, 270, 520], LD_NEW: [450, -525, 520] };
const shoot = async ([x, z, d]) => {
  await page.evaluate(async ([x, z, d]) => {
    const st = window.__stage;
    st.controls.setLookAt(x - d * 0.6, d * 0.55, z + d * 0.8, x, 0, z, false);
    await st.renderFrames(4, 1 / 30);
  }, [x, z, d]);
  return (await page.screenshot({ clip: { x: 160, y: 100, width: 320, height: 200 } })).toString('base64');
};
const empty = {};
for (const [id, site] of Object.entries(SITES)) empty[id] = await shoot(site);
await page.evaluate(async (ids) => {
  const st = window.__stage;
  const s = structuredClone(window.__store.snap.value);
  for (const id of ids) { s.C[id].installed = true; s.C[id].closed = true; }
  st.setState(s);
  await st.renderFrames(240, 1 / 30); // long enough for the rows and containers to rise
}, Object.keys(SITES));
let failed = 0;
for (const [id, site] of Object.entries(SITES)) {
  const built = await shoot(site);
  const diff = await page.evaluate(async ([a, b]) => {
    const load = async (s) => createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = new OffscreenCanvas(ia.width, ia.height);
    const g = c.getContext('2d');
    g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, ia.width, ia.height).data;
    g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, ia.width, ia.height).data;
    let changed = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60) changed++;
    return changed / (da.length / 4);
  }, [empty[id], built]);
  const ok = diff > 0.05;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(7)} ${(diff * 100).toFixed(1)}% of the site view changed when built`);
}
await browser.close();
if (failed || errors.length) { console.error('builds check failed', errors); process.exit(1); }
console.log('builds check passed: every buildable plant appears');
