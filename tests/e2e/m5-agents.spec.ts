import { expect, test, type Page } from '@playwright/test';

const OUT = process.env.SHOTS_DIR ?? 'docs/screens/m5';
const northWest = 'view=-8.0,54.0,260000,40,-10';
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 86 });

async function open(page: Page, query: string, settleMs = 14_000) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { __twinNetwork?: boolean }).__twinNetwork === true, null, { timeout: 240_000 });
  await page.waitForTimeout(settleMs);
  return errors;
}

test('storm: trip under comms loss, policy trade-off, approval to the audit trail', async ({ page }) => {
  const errors = await open(page, `scenario=storm&hours=12.1&${northWest}`);
  await expect(page.getByRole('status').filter({ hasText: 'COMMS LOST' })).toBeVisible();
  const card = page.getByRole('dialog', { name: 'Recommendation awaiting decision' });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText('Relieve Carrick-on-Shannon to Arigna 110 kV');
  await expect(card).toContainText('Withheld');
  await shot(page, 'specimen-storm-1205-consistency');

  // Prefer availability: stale assets are used, flagged, and confidence drops.
  await page.getByRole('button', { name: 'Prefer availability' }).click();
  await expect(card.getByText('stale').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3_000);
  await shot(page, 'specimen-storm-1205-availability');

  // Modify then approve: logged with rule set and inputs hash.
  await card.getByRole('button', { name: 'Modify' }).click();
  await card.getByRole('slider', { name: 'Scale actions' }).fill('0.8');
  await card.getByRole('button', { name: 'Approve modified' }).click();
  await expect(page.getByText(/Approved and logged/)).toBeVisible();
  await page.getByRole('button', { name: /Audit trail/ }).click();
  const audit = page.getByRole('dialog', { name: 'Audit trail' });
  await expect(audit).toContainText('modified and approved');
  await expect(audit).toContainText('Relieve Carrick-on-Shannon to Arigna 110 kV');
  await page.waitForTimeout(2_000);
  await shot(page, 'specimen-storm-audit-trail');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('control room: feed and inspector on the overloaded circuit', async ({ page }) => {
  const errors = await open(page, `theme=control&scenario=storm&hours=12.6&${northWest}&branch=Carrick-on-Shannon to Arigna 110 kV&feed=1`);
  await expect(page.getByRole('region', { name: 'Asset inspector' })).toContainText('Carrick-on-Shannon to Arigna 110 kV');
  await expect(page.getByRole('complementary', { name: 'Agent feed' })).toBeVisible();
  // Expand the first entry to show rule, inputs, threshold and outcome.
  await page.getByRole('complementary', { name: 'Agent feed' }).locator('li button').first().click();
  await page.waitForTimeout(2_000);
  await shot(page, 'control-storm-1236-feed-inspector');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('extended rules catch the Srananagh gas trend; base rules do not', async ({ page }) => {
  const q = `scenario=today&hours=10&view=-8.45,54.2,90000,48,-15&branch=Srananagh 220/110 kV transformers`;
  const errors = await open(page, q);
  const insp = page.getByRole('region', { name: 'Asset inspector' });
  await expect(insp).toContainText(/TX-E-0(08|10|11)/, { timeout: 60_000 });
  await shot(page, 'specimen-srananagh-extended');
  await page.goto(`/?${q}&maturity=base`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as unknown as { __twinNetwork?: boolean }).__twinNetwork === true, null, { timeout: 240_000 });
  await page.waitForTimeout(14_000);
  await expect(page.getByRole('region', { name: 'Asset inspector' })).not.toContainText(/TX-E-0(08|10|11)/);
  await shot(page, 'specimen-srananagh-base');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('governance and method views', async ({ page }) => {
  const errors = await open(page, 'scenario=today&hours=15&governance=1', 10_000);
  await expect(page.getByRole('dialog', { name: 'Governance' })).toContainText('Authority');
  await shot(page, 'specimen-governance');
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await expect(page.getByRole('region', { name: 'Method notes' })).toBeVisible();
  await page.waitForTimeout(1_500);
  await shot(page, 'specimen-method-notes');
  expect(errors, errors.join('\n')).toEqual([]);
});
