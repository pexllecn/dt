// Dev helper: walk a Director script with the arrow keys and screenshot every beat.
// Usage: node tools/beats.mjs <script> <outDir> [theme] [settleMs]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [script = 'today', out = 'beats', theme = 'specimen', settle = '9000'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--use-vulkan=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:5173/?mode=director&script=${script}&theme=${theme}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__twinReady === true && !!window.__twin?.useSim.getState().day, null, { timeout: 180000 });
const n = await page.evaluate(() => document.querySelectorAll('[aria-label^="Beat "]').length);
for (let i = 0; i < n; i++) {
  await page.waitForTimeout(Number(settle));
  // Decision beats: act as the presenter would.
  const approve = page.getByRole('button', { name: /^Approve/ }).first();
  if (await approve.isVisible().catch(() => false)) {
    await page.screenshot({ path: `${out}/${script}-${theme}-${String(i + 1).padStart(2, '0')}-before-decision.jpg`, type: 'jpeg', quality: 80, timeout: 180000 });
    await approve.click();
    await page.waitForTimeout(3000);
  }
  await page.screenshot({ path: `${out}/${script}-${theme}-${String(i + 1).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 80, timeout: 180000 });
  const caption = await page.evaluate(() => document.querySelector('[aria-live="polite"] p.caption')?.textContent ?? '');
  console.log(i + 1, caption);
  await page.keyboard.press('ArrowRight');
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
