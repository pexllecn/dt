// Captures screenshots of the built app from file:// with headless Chromium (SwiftShader).
// Usage: node tools/shoot.mjs out.png "query" [width] [height]
import { chromium } from 'playwright-core';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [out, query = '', w = '1600', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const logs = [];
const t0 = Date.now();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { logs.push(`${m.type()}: ${m.text()}`); if (process.env.VERBOSE) console.log(((Date.now() - t0) / 1000).toFixed(1), m.text().slice(0, 300)); } });
page.on('pageerror', (e) => logs.push(`pageerror: ${e}`));
await page.goto(pathToFileURL(join(root, 'dist/index.html')).href + (query ? `?${query}` : ''));
await page.waitForSelector('body[data-ready="1"]', { timeout: 600000, state: 'attached' });
const stats = await page.evaluate(() => window.__stats ?? null);
await page.screenshot({ path: out });
await browser.close();
console.log(JSON.stringify({ out, seconds: (Date.now() - t0) / 1000, stats, logs: logs.slice(0, 12) }));
