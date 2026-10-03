import { expect, test, type Page } from '@playwright/test';

/**
 * M8: every Director beat of every script, in both themes. Each beat must show a caption, keep
 * the honesty badge, raise no page error, and show the content it is about. Decision beats are
 * approved as a presenter would, and the decision must reach the audit trail.
 */
const OUT = process.env.SHOTS_DIR ?? 'docs/screens/m8';
const SETTLE = Number(process.env.BEAT_SETTLE_MS ?? 9_000);
const scripts = ['today', 'hero', 'storm', 'y2034'] as const;
const themes = (process.env.THEMES ?? 'specimen,control').split(',');

const checks: Record<string, (page: Page) => Promise<void>> = {
  'storm/comms-lost': async (page) => await expect(page.getByRole('status').filter({ hasText: 'COMMS LOST' })).toBeVisible(),
  'storm/overload': async (page) => await expect(page.getByRole('dialog', { name: 'Recommendation awaiting decision' })).toContainText('Carrick-on-Shannon to Arigna'),
  'hero/studies': async (page) => await expect(page.getByRole('region', { name: 'Connection request' })).toContainText('Low-wind week', { timeout: 60_000 }),
  'hero/firm': async (page) => await expect(page.getByRole('region', { name: 'Connection request' })).toContainText('Vegetation survey'),
  'hero/evidence-pack': async (page) => await expect(page.getByRole('dialog', { name: 'Evidence pack' })).toContainText('METHOD-FIRM-01'),
  'y2034/five-corridors': async (page) => await expect(page.getByRole('region', { name: 'Top five constrained corridors' }).locator('li')).toHaveCount(5, { timeout: 60_000 }),
  'today/agent-feed': async (page) => await expect(page.getByRole('complementary', { name: 'Agent feed' })).toBeVisible(),
};

for (const theme of themes) {
  for (const script of scripts) {
    test(`${theme}: ${script}, every beat`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`/?mode=director&script=${script}&theme=${theme}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as unknown as { __twinReady?: boolean }).__twinReady === true, null, { timeout: 240_000 });
      const beats = page.locator('[aria-label^="Beat "]');
      await expect(beats.first()).toBeVisible({ timeout: 120_000 });
      const n = await beats.count();
      expect(n).toBeGreaterThan(4);
      let decisions = 0;
      for (let i = 0; i < n; i++) {
        await page.waitForTimeout(SETTLE);
        const id = await page.evaluate(() => {
          const t = (window as unknown as { __twin: { useDirector: { getState(): { beat: number } } } }).__twin;
          return t.useDirector.getState().beat;
        });
        expect(id).toBe(i);
        const label = (await beats.nth(i).getAttribute('aria-label')) ?? '';
        const beatId = label.replace(/^Beat \d+: /, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
        await expect(page.locator('[aria-live="polite"] p.caption').first()).not.toBeEmpty();
        await expect(page.getByText('Demonstration environment.').first()).toBeVisible();
        const check = checks[`${script}/${beatId}`];
        if (check) await check(page);
        await page.screenshot({ path: `${OUT}/${theme}-${script}-${String(i + 1).padStart(2, '0')}-${beatId}.jpg`, type: 'jpeg', quality: 82, timeout: 180_000 });
        // Decision beats: approve as the presenter would, and check the audit trail.
        const waiting = (script === 'hero' && beatId === 'decision') || (script === 'storm' && beatId === 'policy');
        if (waiting) {
          const approve = page.getByRole('button', { name: /^Approve/ }).first();
          await expect(approve).toBeVisible({ timeout: 60_000 });
          await approve.click();
          decisions++;
          await expect(page.getByRole('button', { name: /Audit trail/ })).toContainText(String(decisions));
        }
        if (i + 1 < n) await page.keyboard.press('ArrowRight');
      }
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
}
