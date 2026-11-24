import { readFileSync } from 'node:fs';

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { addCase, mockApi } from './mock-api.mjs';

const en = JSON.parse(readFileSync(new URL('../../src/i18n/locales/en.json', import.meta.url), 'utf8'));

/** WCAG 2.1 A and AA rules, reported with the offending selectors for a readable failure. */
async function expectNoViolations(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.flatMap(({ id, nodes }) => nodes.map((node) =>
    `${id}: ${node.target.join(' ')} — ${node.failureSummary?.split('\n').slice(1).join(' ').trim()}`))).toEqual([]);
}

test('keyboard users can skip straight to the page content', async ({ page }) => {
  await mockApi(page);
  await page.goto('/events/jazz-night');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: en['a11y.skipToContent'] });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('main').first()).toBeFocused();
});

test('every page has a title naming it', async ({ page }) => {
  await mockApi(page, { role: 'admin' });
  for (const [path, key] of [
    ['/', 'catalogue.title'], ['/support', 'common.help'], ['/notifications', 'notifications.title'],
    ['/admin', 'adminOverview.title'], ['/admin/disputes', 'adminDisputes.title'], ['/staff/support', 'support.queue'],
  ]) {
    await page.goto(path);
    await expect(page).toHaveTitle(`${en[key]} · BiletFlow`);
  }
});

test('the phone menu closes with Escape and returns focus, and closes on an outside tap', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'The menu button only shows at phone widths.');
  await mockApi(page);
  await page.goto('/');
  // The <summary> is the button; its icon covers the visually hidden label.
  const menuButton = page.locator('header summary');
  const menu = page.getByRole('navigation', { name: en['a11y.mobileNavigation'] });
  await menuButton.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(menuButton).toBeFocused();

  await menuButton.click();
  await expect(menu).toBeVisible();
  await page.getByRole('heading', { level: 1 }).click();
  await expect(menu).toBeHidden();
});

test.describe('automated WCAG 2.1 AA checks', () => {
  test('public pages', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Almaty Jazz Night/ }).first()).toBeVisible();
    await expectNoViolations(page);
    await page.goto('/events/jazz-night');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoViolations(page);
  });

  test('support queue and case', async ({ page }) => {
    let number;
    await mockApi(page, { role: 'organizer', seed: (state) => { number = addCase(state); } });
    await page.goto('/staff/support');
    await expect(page.getByRole('list', { name: en['support.queueResults'] })).toBeVisible();
    await expectNoViolations(page);
    await page.goto(`/staff/support/${number}`);
    await expect(page.getByRole('heading', { name: en['support.manageCase'] })).toBeVisible();
    await expectNoViolations(page);
  });

  test('admin disputes, transactions and notifications', async ({ page }) => {
    await mockApi(page, { role: 'admin' });
    await page.goto('/admin/disputes');
    await expect(page.getByText(en['adminDisputes.empty'])).toBeVisible();
    await expectNoViolations(page);
    await page.goto('/admin/transactions?view=payments');
    await expect(page.getByText('sim_abc123')).toBeVisible();
    await expectNoViolations(page);
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: en['notifications.title'] })).toBeVisible();
    await expectNoViolations(page);
  });
});
