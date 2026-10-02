import { expect, test } from '@playwright/test';
import { m3Shots } from './shots';

const OUT = process.env.SHOTS_DIR ?? 'docs/screens/m3';

for (const shot of m3Shots) {
  test(`network: ${shot.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/?${shot.query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as unknown as { __twinNetwork?: boolean }).__twinNetwork === true, null, {
      timeout: 240_000,
    });
    await page.waitForTimeout(shot.settleMs ?? 16_000);
    await page.screenshot({ path: `${OUT}/${shot.name}.jpg`, type: 'jpeg', quality: 86 });
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
