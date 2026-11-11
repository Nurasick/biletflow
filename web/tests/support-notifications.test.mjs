import assert from 'node:assert/strict';
import test from 'node:test';

import { fakeAuthUrl, moduleUrl, scriptApi } from './harness.mjs';

const auth = { '"./auth"': JSON.stringify(fakeAuthUrl) };
const supportUrl = await moduleUrl('../src/shared/api/support.ts', auth);
const { supportApi, staffSupportApi, requesterCaseHref } = await import(supportUrl);
const { notificationsApi } = await import(await moduleUrl('../src/shared/api/notifications.ts', auth));
const { notificationDestination, notificationTitleKey } = await import(
  await moduleUrl('../src/features/Notifications/model/notificationModel.ts')
);
const { queueFilters, staffTransitions, supportKeys } = await import(await moduleUrl(
  '../src/features/Support/model/supportModel.ts', { '"../../../shared/api/support"': JSON.stringify(supportUrl) },
));

const caseNumber = 'SC-261111-7KQ2MX';

test('the notification feed reads its unread count and marks the account inbox read', async () => {
  const feed = { unread: 2, items: [{ id: 7, template_key: 'order.confirmed', read_at: null, payload: {} }] };
  const fake = scriptApi([[200, feed], [204, null]]);
  assert.deepEqual(await notificationsApi.feed(), feed);
  await notificationsApi.markRead();
  assert.deepEqual(fake.calls.map(({ method, path }) => [method, path]), [
    ['GET', '/users/me/notifications'],
    ['POST', '/users/me/notifications/read'],
  ]);
});

test('notification links resolve to local routes and calendar exports without carrying email-link tokens', () => {
  assert.deepEqual(notificationDestination('https://tickets.example/orders/BF-ORDER?token=secret'), {
    kind: 'page', href: '/orders/BF-ORDER', label: 'notifications.viewOrder',
  });
  assert.deepEqual(notificationDestination('https://api.example/api/v1/events/jazz-night/calendar.ics'), {
    kind: 'calendar', slug: 'jazz-night',
  });
  assert.equal(notificationDestination('/organizer/events/17/preview').href, '/organizer/events/17/preview');
  assert.equal(notificationDestination(`/staff/support/${caseNumber}`).href, `/staff/support/${caseNumber}`);
  assert.equal(notificationDestination('javascript:alert(1)'), null);
  assert.equal(notificationDestination('https://example.com/unrecognized/path'), null);
  assert.equal(notificationDestination('/orders/%2Fredirect'), null);
  assert.equal(notificationTitleKey('payment.failed'), 'notifications.paymentFailed');
  assert.equal(notificationTitleKey('__proto__'), 'notifications.generic');
});

test('guest support posts the order proof with context and follows the separate signed case link', async () => {
  const token = 'case&link=+/';
  const input = {
    audience: 'attendee', event_id: 7, order_number: 'BF-ORDER', ticket_code: 'BF-TICKET',
    order_token: 'order-link', contact_email: 'guest@example.com', category: 'ticket_delivery', body: 'Please help.',
  };
  const created = { case_number: caseNumber, access_token: token };
  const fake = scriptApi([[201, created], [200, { status: 'resolved' }], [200, { status: 'in_progress' }]]);
  assert.deepEqual(await supportApi.open(input, false), created);
  assert.equal((await supportApi.case(caseNumber, token)).status, 'resolved');
  assert.equal((await supportApi.reply(caseNumber, token, 'Still missing.')).status, 'in_progress');
  assert.deepEqual(fake.calls[0], { method: 'POST', path: '/support/cases', body: input });
  assert.deepEqual(fake.calls[2].body, { body: 'Still missing.' });
  assert.deepEqual(fake.calls.slice(1).map(({ path }) => new URL(path, 'https://app.example').pathname), [
    `/support/cases/${caseNumber}`, `/support/cases/${caseNumber}/messages`,
  ]);
  for (const path of [requesterCaseHref(caseNumber, token), ...fake.calls.slice(1).map(({ path }) => path)]) {
    assert.deepEqual(Object.fromEntries(new URL(path, 'https://app.example').searchParams), { token });
  }
});

test('the requester and staff use separate case endpoints and cache entries', async () => {
  const fake = scriptApi([[200, []], [200, {}], [200, {}], [200, {}]]);
  await supportApi.mine();
  await supportApi.case(caseNumber, null);
  await staffSupportApi.case(caseNumber);
  await staffSupportApi.reply(caseNumber, 'Staff-only discussion', true);
  assert.deepEqual(fake.calls, [
    { method: 'GET', path: '/support/cases', body: undefined },
    { method: 'GET', path: `/support/cases/${caseNumber}`, body: undefined },
    { method: 'GET', path: `/staff/support/cases/${caseNumber}`, body: undefined },
    { method: 'POST', path: `/staff/support/cases/${caseNumber}/messages`, body: { body: 'Staff-only discussion', is_internal_note: true } },
  ]);
  assert.notDeepEqual(supportKeys.requester(caseNumber, 1, null), supportKeys.staff(caseNumber, 1));
});

test('the staff queue sends all filters, respects page bounds, and unassigns with explicit null', async () => {
  const filters = queueFilters(new URLSearchParams('status=waiting_for_customer&category=refund&event_id=7'));
  const fake = scriptApi([[200, []], [200, {}], [200, {}]]);
  await staffSupportApi.queue(filters, 21, 40);
  await staffSupportApi.update(caseNumber, { assigned_to_user_id: null });
  await staffSupportApi.update(caseNumber, { status: 'resolved' });
  const url = new URL(fake.calls[0].path, 'https://app.example');
  assert.equal(url.pathname, '/staff/support/cases');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    status: 'waiting_for_customer', category: 'refund', event_id: '7', limit: '21', offset: '40',
  });
  assert.deepEqual(fake.calls.slice(1).map(({ body }) => body), [{ assigned_to_user_id: null }, { status: 'resolved' }]);
  assert.deepEqual(queueFilters(new URLSearchParams('status=hidden&category=other&event_id=9007199254740993')), {
    status: undefined, category: undefined, eventId: undefined,
  });
  assert.deepEqual(staffTransitions, {
    open: ['in_progress'], in_progress: ['waiting_for_customer', 'resolved'],
    waiting_for_customer: ['resolved'], resolved: [],
  });
});
