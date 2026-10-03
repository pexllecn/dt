// Visual audit: with every plant built, flies to each component the way the interface does
// (Frame / select) and photographs it in the Physical and Flow lenses, then a contact sheet per lens.
// Usage: node tools/audit.mjs [outdir] [ids,comma,separated]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? join(root, 'docs/audit');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(join(root, 'dist/index.html')).href + '?capture=1&backend=webgl&tier=medium&dock=0&time=12:00');
await page.waitForSelector('body[data-ready="1"]', { timeout: 600000, state: 'attached' });
await page.addStyleTag({ content: '.dock, .feed, .timeline, .badge, .keys, .insp { display: none !important; }' });
const ids = process.argv[3]?.split(',') ?? await page.evaluate(() => [...window.__stage.bounds.keys()]);
await page.evaluate(async () => {
  const st = window.__stage;
  const s = structuredClone(window.__store.snap.value);
  for (const id of ['SOLAR', 'BESS', 'GAS', 'LD_NEW']) { s.C[id].installed = true; s.C[id].closed = true; }
  s.C.GAS.mwNow = 150;
  st.setState(s);
  await st.renderFrames(200, 1 / 30);
});
for (const lens of ['physical', 'flow']) {
  for (const id of ids) {
    await page.evaluate(async ([id, lens]) => {
      const st = window.__stage;
      st.setLens(lens);
      st.flyTo(id);
      await st.renderFrames(90, 1 / 30);
    }, [id, lens]);
    await page.screenshot({ path: join(out, `${lens}-${id}.png`) });
  }
}
console.log(JSON.stringify({ ids, errors }));
await browser.close();
