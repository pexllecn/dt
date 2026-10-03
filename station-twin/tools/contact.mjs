// Contact sheet: tiles images into one PNG for review. node tools/contact.mjs out.png cols img1 img2 ...
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
const [out, cols, ...imgs] = process.argv.slice(2);
const c = Number(cols);
const w = 1600 / c;
const html = `<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(${c},${w}px);gap:2px;font:11px sans-serif;color:#eee">${imgs.map((p) => `<div><img style="width:${w}px;display:block" src="data:image/png;base64,${readFileSync(p).toString('base64')}"><div>${basename(p)}</div></div>`).join('')}</body>`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1600 + c * 2, height: 800 } });
await p.setContent(html);
await p.screenshot({ path: out, fullPage: true });
await b.close();
