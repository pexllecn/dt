// Re-encodes PNG screenshots as smaller JPEGs (1280 px wide) for the repository.
// node tools/jpeg.mjs outDir img1.png img2.png ...
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
const [outDir, ...imgs] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
for (const f of imgs) {
  await p.setContent(`<body style="margin:0"><img style="width:1280px;display:block" src="data:image/png;base64,${readFileSync(f).toString('base64')}"></body>`);
  await p.waitForFunction(() => document.images[0].complete);
  await p.screenshot({ path: join(outDir, basename(f).replace(/\.png$/, '.jpg')), type: 'jpeg', quality: 78 });
}
await b.close();
