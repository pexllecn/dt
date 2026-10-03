// Performance probe: main-thread cost per frame in representative views.
// Usage: node tools/perf.mjs [--base http://127.0.0.1:4173] [--gpu] [--secs 12]
// Reports, per view: world update and render-submission time (ms, averaged), long tasks over
// 50 ms, draw calls and triangles. Frame rate is only meaningful with --gpu on real hardware.
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const base = opt('base', 'http://127.0.0.1:4173');
const secs = Number(opt('secs', 12));
const gpu = args.includes('--gpu');

const views = [
  ['national, explore', 'mode=explore&hours=14'],
  ['regional north west', 'mode=explore&hours=14&view=-8.9,54.0,60000,55,200'],
  ['site close-up', 'mode=explore&hours=15&view=-8.1239,53.9117,650,58,150'],
  ['storm, weather and rain', 'mode=explore&scenario=storm&hours=12.5&view=-8.2,54.0,6000,70,200'],
  ['storm front, director playing', 'mode=director&script=storm&play'],
  ['hero, panels and studies', 'mode=director&script=hero&beat=5'],
  ['2034 corridors, feed open', 'mode=explore&scenario=y2034&hours=18&feed'],
];

const browser = await chromium.launch({
  channel: 'chromium',
  args: gpu
    ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist']
    : ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--use-vulkan=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const rows = [];
for (const [name, q] of views) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.addInitScript(() => {
    window.__longTasks = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__longTasks.push(e.duration))).observe({ type: 'longtask', buffered: true });
  });
  await page.goto(`${base}/?${q}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__twinReady === true && !!window.__twin?.useSim.getState().day, null, { timeout: 300_000 });
  await page.waitForTimeout(6_000);
  await page.evaluate(() => (window.__longTasks = []));
  const t0 = Date.now();
  await page.waitForTimeout(secs * 1000);
  const r = await page.evaluate(() => {
    const f = window.__twin.frameStats;
    const lt = window.__longTasks;
    return { update: f.updateMs, submit: f.submitMs, fps: f.fps, draws: f.drawCalls, tris: f.triangles, long: lt.length, longMax: lt.length ? Math.max(...lt) : 0 };
  });
  rows.push({ name, ...r, secs: (Date.now() - t0) / 1000 });
  await page.close();
}
await browser.close();
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('view', 32), pad('update ms', 10), pad('submit ms', 10), pad('fps', 6), pad('draws', 7), pad('tris M', 7), 'long tasks');
for (const r of rows)
  console.log(pad(r.name, 32), pad(r.update.toFixed(2), 10), pad(r.submit.toFixed(2), 10), pad(r.fps.toFixed(1), 6), pad(r.draws, 7), pad((r.tris / 1e6).toFixed(2), 7), `${r.long} (max ${r.longMax.toFixed(0)} ms)`);
