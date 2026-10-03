import { expect, test } from '@playwright/test';
import { m2Shots } from './shots';

const OUT = process.env.SHOTS_DIR ?? 'docs/screens/m2';

for (const shot of m2Shots) {
  test(`world: ${shot.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/?mode=explore&${shot.query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => (window as unknown as { __twinReady?: boolean }).__twinReady === true, null, {
      timeout: 180_000,
    });
    await page.waitForTimeout(shot.settleMs ?? 14_000);
    await page.screenshot({ path: `${OUT}/${shot.name}.jpg`, type: 'jpeg', quality: 86 });
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
