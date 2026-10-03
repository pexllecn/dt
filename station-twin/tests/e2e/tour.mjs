// The guided tour end to end in the real app (worker, live clock), driven only by the presenter's
// Right key, twice, with a fixed virtual wall clock. Both runs must give identical audit logs.
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = join(root, 'dist/index.html');
if (!existsSync(html)) { console.error('Run "npm run build" first.'); process.exit(1); }
const exe = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function run(n) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.clock.setFixedTime(new Date('2026-03-11T07:40:00.000Z'));
  await page.goto(pathToFileURL(html).href + '?tier=low&backend=webgl&dock=0');
  await page.waitForSelector('body[data-ready="1"]', { timeout: 300000, state: 'attached' });
  const status = () => page.evaluate(() => { const t = window.__store.tour.value; return t ? { beat: t.beat, awaiting: t.awaiting, next: t.nextAction, summary: t.summary } : null; });
  const seen = [];
  let last = '';
  for (let press = 0; press < 80; press++) {
    await page.keyboard.press('ArrowRight');
    // Wait for the worker to answer this press.
    let st = null;
    for (let i = 0; i < 200; i++) {
      await page.waitForTimeout(100);
      st = await status();
      const key = JSON.stringify(st);
      if (st && key !== last) { last = key; break; }
    }
    if (!st) throw new Error('tour did not start');
    seen.push(`${st.beat}:${st.awaiting ?? '-'}`);
    if (st.summary && st.next === 'End of the tour.' && st.awaiting === 'next') break;
  }
  const result = await page.evaluate(() => ({ audit: window.__store.agents.value.audit, tour: window.__store.tour.value, caption: document.querySelector('.tourcap')?.textContent ?? '' }));
  await page.close();
  console.log(`run ${n}: ${seen.length} presses, beats ${[...new Set(seen.map((s) => s.split(':')[0]))].join(',')}, ${result.audit.length} decisions, errors ${errors.length}`);
  return { ...result, errors };
}

const a = await run(1);
const b = await run(2);
await browser.close();
const same = JSON.stringify(a.audit) === JSON.stringify(b.audit);
const ok = same && a.audit.length >= 3 && a.tour.beat === 7 && /Agents recommend\. People decide\. Every decision is traceable\./.test(a.caption) && a.errors.length === 0 && b.errors.length === 0;
console.log(JSON.stringify(a.audit.map((e) => `${e.simT} ${e.operator} ${e.decision} ${e.option}`), null, 1));
if (!ok) { console.error('tour check failed', { same, errors: [...a.errors, ...b.errors] }); process.exit(1); }
console.log('tour check passed: identical audit logs on both runs');
