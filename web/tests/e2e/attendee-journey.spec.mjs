import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { CAMPAIGN_TOKEN, mockApi } from './mock-api.mjs';

const en = JSON.parse(readFileSync(new URL('../../src/i18n/locales/en.json', import.meta.url), 'utf8'));
// "Pay 5,000 ₸ (simulation)": checkout.paySimulated with the amount filled in.
const payButton = /^Pay .+ \(simulation\)$/;
const fill = (key, values) => en[key].replace(/\{\{(\w+)\}\}/g, (_, name) => values[name]);

test('a guest finds an event, follows a campaign link, pays, and gets tickets', async ({ page }) => {
  const api = await mockApi(page);

  // §4.2 discovery: the public catalogue lists the event.
  await page.goto('/');
  await expect(page).toHaveTitle(`${en['catalogue.title']} · BiletFlow`);
  await page.getByRole('link', { name: /Almaty Jazz Night/ }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Almaty Jazz Night' })).toBeVisible();

  // §4.14 campaign link: the promotion applies itself from ?c=.
  await page.goto(`/events/jazz-night?c=${CAMPAIGN_TOKEN}`);
  await page.getByRole('button', { name: fill('booking.addTicket', { name: 'Standard' }) }).click();
  await page.getByRole('button', { name: fill('booking.addTicket', { name: 'Standard' }) }).click();
  await expect(page.getByText(fill('promo.applied', { code: 'STUDENT20' }))).toBeVisible();

  // §4.4 checkout as a guest, then §4.6 the simulated payment.
  await page.getByLabel(en['checkout.contactName']).fill('Dana Guest');
  await page.getByLabel(en['common.email']).fill('dana@example.com');
  await page.getByRole('button', { name: en['checkout.continueToPayment'] }).click();
  await expect(page).toHaveURL(/\/orders\/BF-1001\?token=/);
  const checkout = api.calls.find((call) => call.method === 'POST' && call.path === '/events/jazz-night/orders');
  expect(checkout.body).toMatchObject({ contact_email: 'dana@example.com', campaign_token: CAMPAIGN_TOKEN });
  expect(checkout.body.items[0].attendees).toHaveLength(2);

  await page.getByRole('button', { name: payButton }).click();
  await expect(page.getByText(en['orders.confirmed'])).toBeVisible();

  // §4.7 tickets: a QR per ticket and a PDF of all of them.
  await expect(page.getByRole('img', { name: fill('orders.qrLabel', { code: 'BF-T1' }) })).toBeVisible();
  await expect(page.getByRole('img', { name: fill('orders.qrLabel', { code: 'BF-T2' }) })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: en['orders.downloadAll'] }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
  expect(api.unhandled).toEqual([]);
});

test('an attendee asks for help from an order and follows the support thread', async ({ page }) => {
  const api = await mockApi(page, { role: 'attendee' });
  await page.goto('/events/jazz-night');
  await page.getByRole('button', { name: fill('booking.addTicket', { name: 'Standard' }) }).click();
  await page.getByRole('button', { name: en['checkout.continueToPayment'] }).click();
  await page.getByRole('button', { name: payButton }).click();
  await expect(page.getByText(en['orders.confirmed'])).toBeVisible();

  // §4.13: the case starts with the order's context and attendee-only categories.
  await page.getByRole('button', { name: en['support.orderHelp'] }).click();
  const dialog = page.getByRole('dialog');
  const category = dialog.getByLabel(en['support.categoryLabel']);
  await expect(category.locator('option', { hasText: en['support.category.activation'] })).toHaveCount(0);
  await category.selectOption('ticket_delivery');
  await dialog.getByLabel(en['support.message']).fill('My tickets did not arrive by email.');
  await dialog.getByRole('button', { name: en['support.openCase'] }).click();

  await expect(page.getByText(en['support.created'])).toBeVisible();
  await expect(page.getByText('My tickets did not arrive by email.')).toBeVisible();
  const opened = api.calls.find((call) => call.method === 'POST' && call.path === '/support/cases');
  expect(opened.body).toMatchObject({ audience: 'attendee', category: 'ticket_delivery', order_number: 'BF-1001' });

  await page.getByLabel(en['support.message']).fill('Checked spam too, still nothing.');
  await page.getByRole('button', { name: en['support.sendReply'] }).click();
  await expect(page.getByText('Checked spam too, still nothing.')).toBeVisible();
  expect(api.unhandled).toEqual([]);
});
