// Opens the single-file build from file:// in headless Chromium and checks that it runs offline:
// the inline worker advances the clock, a scenario can be driven, and no network request is made.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = join(root, 'dist/index.html');
if (!existsSync(html)) { console.error('Run "npm run build" first.'); process.exit(1); }
const exe = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const external = [];
const errors = [];
page.on('request', (r) => { const u = r.url(); if (!/^(file|data|blob):/.test(u)) external.push(u); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(pathToFileURL(html).href + '?console');
await page.waitForSelector('body[data-ready="1"]', { timeout: 15000 });
const info = await page.evaluate(() => ({ secure: window.isSecureContext, webgpu: 'gpu' in navigator, worker: typeof Worker }));
const t0 = await page.textContent('#clock');
await page.waitForTimeout(2500);
const t1 = await page.textContent('#clock');
await page.click('button[data-s="peak"]');
await page.waitForTimeout(400);
const condPeak = await page.textContent('#cond');
await page.waitForTimeout(4000);
const n1Text = await page.textContent('#n1');
await page.click('button[data-s="n1"]');
await page.waitForTimeout(600);
const condN1 = await page.textContent('#cond');
// The 3D station boots from file:// too (WebGL2, low tier keeps software rendering quick).
const app = await browser.newPage({ viewport: { width: 1280, height: 720 } });
app.on('request', (r) => { const u = r.url(); if (!/^(file|data|blob):/.test(u)) external.push(u); });
app.on('pageerror', (e) => errors.push(String(e)));
await app.goto(pathToFileURL(html).href + '?capture=1&frames=2&tier=low&backend=webgl');
await app.waitForSelector('body[data-ready="1"]', { timeout: 300000, state: 'attached' });
const appStats = await app.evaluate(() => window.__stats);
const appCondition = await app.textContent('.cond');
await browser.close();

const result = { info, clockAdvanced: t0 !== t1, t0, t1, condPeak, n1Text, condN1, appStats, appCondition, external, errors };
console.log(JSON.stringify(result, null, 2));
const ok = result.clockAdvanced && condN1 === 'Emergency' && appStats && appStats.drawCalls > 50 && appCondition === 'Normal' && external.length === 0 && errors.length === 0;
if (!ok) { console.error('file:// check FAILED'); process.exit(1); }
console.log('file:// check passed');
