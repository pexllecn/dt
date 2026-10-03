// Main-thread profile while a Director script plays: long tasks, material builds after load
// (with ?debugbuild), and the top functions by self time.
// Usage: node tools/profile.mjs "mode=director&script=storm&debugbuild"   (preview on :4173)
import { chromium } from '@playwright/test';
const q = process.argv[2];
const browser = await chromium.launch({ channel: 'chromium', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--use-vulkan=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://127.0.0.1:4173/?' + q, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__twinReady === true && !!window.__twin?.useSim.getState().day && window.__twinNetwork === true, null, { timeout: 300000 });
await page.waitForTimeout(8000);
await page.evaluate(() => (window.__readyAt = performance.now() / 1000));
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await page.evaluate(() => { window.__lt = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(Math.round(e.duration)))).observe({ type: 'longtask' }); });
await page.evaluate(() => window.__twin.useDirector.getState().set({ playing: true }));
await page.waitForTimeout(40000);
console.log("long tasks", await page.evaluate(() => JSON.stringify(window.__lt)));
console.log("builds after ready:\n" + await page.evaluate(() => (window.__builds ?? []).filter((x) => parseFloat(x) > window.__readyAt).join("\n")));
const { profile } = await cdp.send('Profiler.stop');
const frames = await page.evaluate(() => window.__twin.frameStats.fps);
// self time per function
const dt = profile.timeDeltas;
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
for (let i = 0; i < profile.samples.length; i++) {
  const n = byId.get(profile.samples[i]);
  const f = n.callFrame;
  const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const idle = (self.get('(idle) :-1') ?? 0) + (self.get('(program) :-1') ?? 0);
console.log(`sampled ${(total / 1000).toFixed(1)} s, idle+program ${(idle / 1000).toFixed(1)} s, gc ${((self.get('(garbage collector) :-1') ?? 0) / 1000).toFixed(2)} s, fps ${frames.toFixed(2)}`);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log(`${(v).toFixed(0).padStart(7)} ms  ${k}`);
await browser.close();
