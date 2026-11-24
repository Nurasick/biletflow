import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { addCase, mockApi } from './mock-api.mjs';

const en = JSON.parse(readFileSync(new URL('../../src/i18n/locales/en.json', import.meta.url), 'utf8'));
const fill = (key, values) => en[key].replace(/\{\{(\w+)\}\}/g, (_, name) => values[name]);
// A 1×1 PNG, small enough to pass the 2 MB attachment limit.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('the organizer works a case: filters the queue, assigns event staff, escalates, and attaches a file', async ({ page }) => {
  let caseNumber;
  const api = await mockApi(page, { role: 'organizer', seed: (state) => {
    caseNumber = addCase(state);
    addCase(state, { audience: 'organizer', category: 'activation', contact_email: 'other@example.com' });
  } });

  await page.goto('/staff/support');
  await expect(page).toHaveTitle(`${en['support.queue']} · BiletFlow`);
  const results = page.getByRole('list', { name: en['support.queueResults'] });
  await expect(results.getByRole('listitem')).toHaveCount(2);

  // §4.13 queue filters: audience, the event picker (not a raw ID), and text search.
  const filters = page.getByRole('search', { name: en['support.queueFilters'] });
  await filters.getByLabel(en['support.audienceLabel']).selectOption('attendee');
  await filters.getByLabel(en['support.eventLabel'], { exact: true }).selectOption({ label: 'Almaty Jazz Night' });
  await filters.getByLabel(en['support.queueSearch']).fill('guest@example.com');
  await filters.getByRole('button', { name: en['reports.applyFilters'] }).click();
  await expect(page).toHaveURL(/audience=attendee/);
  await expect(results.getByRole('listitem')).toHaveCount(1);
  const queued = api.calls.findLast((call) => call.path === '/staff/support/cases');
  expect(new URLSearchParams(queued.search)).toEqual(new URLSearchParams(
    `limit=21&offset=0&event_id=7&audience=attendee&q=${encodeURIComponent('guest@example.com')}`));

  await results.getByRole('link').first().click();
  await expect(page.getByText('I was charged twice for one ticket.')).toBeVisible();

  // Assign to a member of the event's staff, not only to oneself.
  await page.getByText(en['support.assignStaff']).click();
  await page.getByRole('button', { name: fill('support.assignTo', { name: 'Sanzhar Staff' }) }).click();
  await expect(page.getByText(fill('support.assignedId', { id: 4 }))).toBeVisible();

  // Escalate to Platform Admins with a reason.
  await page.getByRole('button', { name: en['support.escalate'] }).click();
  const dialog = page.getByRole('dialog', { name: en['support.escalateTitle'] });
  await dialog.getByLabel(en['ops.reasonRequired']).fill('Double charge needs the payment provider.');
  await dialog.getByRole('button', { name: en['support.escalate'] }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Double charge needs the payment provider.')).toBeVisible();
  expect(api.cases.get(caseNumber)).toMatchObject({ is_escalated: true, assigned_to_user_id: 4 });

  // Bonus: attach a screenshot; it shows up with a preview.
  await page.getByLabel(en['support.addAttachment']).setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('img', { name: fill('support.attachmentPreview', { name: 'receipt.png' }) })).toBeVisible();
  // Files the backend would refuse are stopped before upload.
  await page.getByLabel(en['support.addAttachment']).setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  await expect(page.getByText(en['support.attachmentType'])).toBeVisible();
  expect(api.cases.get(caseNumber).attachments).toHaveLength(1);
  expect(api.unhandled).toEqual([]);
});

test('admins see escalated cases from the sidebar and the overview links to open work', async ({ page }) => {
  const api = await mockApi(page, { role: 'admin', seed: (state) => {
    addCase(state, { is_escalated: true, escalation_reason: 'Payment provider issue', escalated_at: '2026-11-24T08:00:00Z' });
    addCase(state);
  } });
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: en['adminOverview.openSupport'] })).toHaveAttribute('href', '/staff/support?status=open');
  await expect(page.getByRole('link', { name: en['adminOverview.openDisputes'] })).toHaveAttribute('href', '/admin/disputes?status=open');
  await page.getByRole('navigation', { name: en['ops.adminWorkspace'] }).getByRole('link', { name: en['adminSupport.escalated'] }).click();
  await expect(page.getByLabel(en['support.escalatedOnly'])).toBeChecked();
  await expect(page.getByRole('list', { name: en['support.queueResults'] }).getByRole('listitem')).toHaveCount(1);
  expect(api.unhandled).toEqual([]);
});

test('an admin records a dispute, reviews it, and resolves it for the attendee', async ({ page }) => {
  const api = await mockApi(page, { role: 'admin' });
  await page.goto('/admin/disputes');
  await expect(page).toHaveTitle(`${en['adminDisputes.title']} · BiletFlow`);
  await expect(page.getByText(en['adminDisputes.empty'])).toBeVisible();

  await page.getByText(en['adminDisputes.open']).click();
  await page.getByRole('button', { name: en['adminDisputes.submit'] }).click();
  await expect(page.getByText(en['adminDisputes.orderRequired'])).toBeVisible();
  await page.getByLabel(en['reports.order'], { exact: true }).fill('BF-0999');
  await page.getByLabel(en['adminDisputes.amount']).fill('2500,50');
  await page.getByLabel(en['ops.reason'], { exact: true }).fill('Card holder says the event never happened.');
  await page.getByRole('button', { name: en['adminDisputes.submit'] }).click();
  await expect(page.getByText(fill('adminDisputes.opened', { id: 1 }))).toBeVisible();
  expect(api.calls.find((call) => call.method === 'POST' && call.path === '/admin/disputes').body).toEqual({
    order_number: 'BF-0999', reason: 'Card holder says the event never happened.', amount_minor: 250_050,
  });

  await page.getByRole('button', { name: fill('adminDisputes.reviewLabel', { id: 1 }) }).click();
  const dialog = page.getByRole('dialog', { name: fill('adminDisputes.reviewTitle', { id: 1 }) });
  await dialog.getByLabel(en['support.statusLabel']).selectOption('resolved_attendee');
  await dialog.getByLabel(en['adminDisputes.resolution']).fill('Refund approved.');
  await dialog.getByRole('button', { name: en['organizer.save'] }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('table').getByText(en['adminDisputes.status.resolved_attendee'])).toBeVisible();
  expect(api.disputes[0]).toMatchObject({ status: 'resolved_attendee', resolution_notes: 'Refund approved.' });
  expect(api.unhandled).toEqual([]);
});

test('an admin searches payments, exports CSVs, and suspends an event with a reason', async ({ page }) => {
  const api = await mockApi(page, { role: 'admin' });

  await page.goto('/admin/transactions?view=payments');
  await page.getByLabel(en['adminFinance.searchPayments']).fill('sim_abc123');
  await page.getByRole('button', { name: en['ops.search'] }).click();
  await expect(page).toHaveURL(/q=sim_abc123/);
  await expect(page.getByText('sim_abc123')).toBeVisible();
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: en['adminFinance.exportPayments'] }).click();
  expect((await csv).suggestedFilename()).toBe('biletflow-payments.csv');
  expect(api.calls.findLast((call) => call.path === '/admin/exports/payments.csv').search).toBe('?q=sim_abc123');

  // §4.12 moderation: filter by status, open the event, suspend it.
  await page.goto('/admin/events');
  await page.getByLabel(en['support.statusLabel']).selectOption('published');
  await page.getByRole('button', { name: en['ops.search'] }).click();
  await page.getByRole('link', { name: /Almaty Jazz Night/ }).click();
  await page.getByRole('button', { name: en['ops.suspendEvent'] }).click();
  const dialog = page.getByRole('dialog', { name: en['ops.suspendEventConfirm'] });
  await dialog.getByLabel(en['ops.reason']).fill('Reported as a duplicate listing.');
  await dialog.getByRole('button', { name: en['ops.confirm'] }).click();
  await expect(page.getByText(en['ops.saved'])).toBeVisible();
  expect(api.event.status).toBe('suspended');
  expect(api.calls.find((call) => call.path === '/admin/events/7/suspend').body).toEqual({ reason: 'Reported as a duplicate listing.' });

  // The timeline filters in the event's time zone (Asia/Almaty, UTC+5).
  await page.getByLabel(en['reports.since']).fill('2026-11-20T10:00');
  await page.getByRole('button', { name: en['reports.applyFilters'] }).click();
  await expect.poll(() => api.calls.findLast((call) => call.path === '/admin/events/7/timeline')?.search)
    .toContain('since=2026-11-20T05%3A00%3A00.000Z');
  expect(api.unhandled).toEqual([]);
});

test('the organizer dashboard lists the organizer’s events', async ({ page }) => {
  const api = await mockApi(page, { role: 'organizer' });
  await page.goto('/organizer/events');
  await expect(page).toHaveTitle(`${en['eventWorkflow.myEvents']} · BiletFlow`);
  await expect(page.getByRole('heading', { name: 'Almaty Jazz Night' })).toBeVisible();
  expect(api.unhandled).toEqual([]);
});

test('one notification is marked read on its own and support statuses read in the interface language', async ({ page }) => {
  const api = await mockApi(page, { role: 'attendee' });
  await page.goto('/notifications');
  await expect(page.getByText(fill('notifications.unreadCount', { unread: 2 }), { exact: true })).toBeVisible();
  const ru = JSON.parse(readFileSync(new URL('../../src/i18n/locales/ru.json', import.meta.url), 'utf8'));
  await page.getByRole('combobox', { name: en['locale.label'] }).selectOption('ru');
  await expect(page.getByText(ru['support.status.resolved'], { exact: false })).toBeVisible();
  await page.getByRole('combobox', { name: ru['locale.label'] }).selectOption('en');

  await page.getByRole('button', { name: fill('notifications.markOneLabel', { title: en['notifications.supportStatus'] }) }).click();
  await expect(page.getByText(fill('notifications.unreadCount', { unread: 1 }), { exact: true })).toBeVisible();
  expect(api.calls.filter((call) => call.method === 'POST' && call.path.includes('/notifications')).map((call) => call.path))
    .toEqual(['/users/me/notifications/501/read']);
  expect(api.unhandled).toEqual([]);
});
