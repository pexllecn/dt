// Dev helper: screenshot the running app with Playwright (WebGPU via SwiftShader in this container).
// Usage: node tools/shoot.mjs out.png "query=string" [waitMs] [width] [height]
import { chromium } from '@playwright/test';

const [out, query = '', wait = '8000', w = '1600', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--use-vulkan=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:5173/?${query}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
try {
  await page.waitForFunction(() => window.__twinReady === true, null, { timeout: 120000 });
} catch {
  logs.push('[shoot] timed out waiting for ready');
}
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out, timeout: 180000 });
console.log([...new Set(logs)].filter((l) => !l.includes("[vite]")).slice(0, 40).join("\n"));
await browser.close();
