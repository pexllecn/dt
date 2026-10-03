// Record a Director script to video, frame by frame on a virtual clock, so the result is smooth
// whatever the machine's frame rate. Each frame advances page time by 1/fps, is screenshotted,
// and ffmpeg encodes the sequence.
//
//   node tools/capture.mjs <today|hero|storm|y2034> [--out public/video/01-today.mp4]
//        [--fps 30] [--size 1920x1080] [--theme specimen|control] [--max 140] [--gpu]
//        [--base http://127.0.0.1:4173]
//
// Decision beats wait for a person; for a recording the script presses Approve, as the
// presenter would, and this is stated in the video's caption track (see docs).
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const script = args[0] ?? 'today';
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const names = { today: '01-today', hero: '02-hero', storm: '03-storm', y2034: '04-2034' };
const out = opt('out', `public/video/${names[script] ?? script}.mp4`);
const fps = Number(opt('fps', 30));
const [w, h] = opt('size', '1920x1080').split('x').map(Number);
const theme = opt('theme', 'specimen');
const maxSeconds = Number(opt('max', 140));
const base = opt('base', 'http://127.0.0.1:4173');
const gpu = args.includes('--gpu');

const frames = path.join(path.dirname(out), `.frames-${script}`);
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const browser = await chromium.launch({
  channel: 'chromium',
  args: gpu
    ? ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist']
    : ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--use-vulkan=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/?mode=director&script=${script}&theme=${theme}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });

// Load on real time (tiles and the simulation use real timers), then let the view settle.
await page.waitForFunction(() => window.__twinReady === true && !!window.__twin?.useSim.getState().day, null, { timeout: 300_000 });
await page.waitForTimeout(8_000);
// From here on, page time only advances when a frame is captured.
await page.clock.install();
await page.clock.pauseAt(Date.now() + 1_000);
await page.evaluate(() => window.__twin.useDirector.getState().set({ playing: true }));

const step = 1000 / fps;
let n = 0;
for (; n < maxSeconds * fps; n++) {
  await page.clock.runFor(step);
  await page.screenshot({ path: path.join(frames, `${String(n).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 92, timeout: 180_000 });
  const state = await page.evaluate(() => {
    const d = window.__twin.useDirector.getState();
    return { playing: d.playing, waiting: d.waiting };
  });
  if (state.waiting) {
    const approve = page.getByRole('button', { name: /^Approve/ }).first();
    if (await approve.isVisible().catch(() => false)) await approve.click();
  }
  if (!state.playing) break;
  if (n % (fps * 5) === 0) process.stdout.write(`${(n / fps).toFixed(0)} s `);
}
await browser.close();
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(frames, '%05d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', out]);
rmSync(frames, { recursive: true, force: true });
console.log(`\n${out}: ${(n / fps).toFixed(1)} s, ${n} frames${errors.length ? `\nPAGE ERRORS:\n${errors.join('\n')}` : ''}`);
