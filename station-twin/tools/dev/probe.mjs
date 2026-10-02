// Evaluates an expression in the built app after capture: node tools/dev/probe.mjs "query" "expr"
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';
const [query, expr] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => console.log('pageerror', String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.text().slice(0, 300)); });
await page.goto(pathToFileURL('dist/index.html').href + '?' + query);
await page.waitForSelector('body[data-ready="1"]', { timeout: 600000, state: 'attached' });
console.log(JSON.stringify(await page.evaluate(expr), null, 1));
await browser.close();
