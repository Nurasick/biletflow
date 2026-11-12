import assert from 'node:assert/strict';
import test from 'node:test';

import { fakeAuthUrl, moduleUrl, scriptApi } from './harness.mjs';

const staffUrl = await moduleUrl('../src/shared/api/staff.ts', { '"./auth"': JSON.stringify(fakeAuthUrl) });
const adminUrl = await moduleUrl('../src/shared/api/admin.ts', { '"./auth"': JSON.stringify(fakeAuthUrl) });
const modelUrl = await moduleUrl('../src/features/Operations/model/operationsModel.ts');
const hundredthsUrl = await moduleUrl('../src/shared/lib/parseHundredths.ts');
const feeModelUrl = await moduleUrl('../src/features/Operations/model/adminSettingsModel.ts', {
  '"../../../shared/lib/parseHundredths"': JSON.stringify(hundredthsUrl),
});
const { checkInApi } = await import(staffUrl);
const { adminApi } = await import(adminUrl);
const { ticketAction, eventModerationActions, activationModerationAction, validEventId, operationsKeys } = await import(modelUrl);
const { readFeeDraft } = await import(feeModelUrl);
const event = { id: 7, slug: 'private-night', status: 'suspended', title: 'Private Night' };
const ticket = { public_code: 'T-A/B', status: 'valid', attendee_name: 'Alex', ticket_type_name: 'General' };

test('staff lists only server-assigned events and reads live attendance', async () => {
  const counts = { registered: 30, checked_in: 12, absent: 18, checked_in_percent: 40 };
  const fake = scriptApi([[200, [event]], [200, counts]]);
  assert.deepEqual(await checkInApi.events(), [event]);
  assert.deepEqual(await checkInApi.attendance(7), counts);
  assert.deepEqual(fake.calls.map((call) => [call.method, call.path]), [
    ['GET', '/staff/events'], ['GET', '/staff/events/7/attendance'],
  ]);
});

test('attendee search trims and URL-encodes names and literal search characters', async () => {
  const fake = scriptApi([[200, [ticket]]]);
  assert.deepEqual(await checkInApi.search(7, '  A&B / % А  '), [ticket]);
  assert.equal(new URL(fake.calls[0].path, 'https://example.test').searchParams.get('q'), 'A&B / % А');
  assert.equal(fake.calls[0].method, 'GET');
});

test('scanning uses raw admission content and bounded device metadata', async () => {
  const response = { outcome: 'valid', ticket: { ...ticket, status: 'checked_in' } };
  const fake = scriptApi([[200, response]]);
  assert.deepEqual(await checkInApi.scan(7, 'signed.qr.payload', 'x'.repeat(240)), response);
  assert.deepEqual(fake.calls[0], { method: 'POST', path: '/staff/events/7/scan', body: {
    qr: 'signed.qr.payload', device_info: 'x'.repeat(200),
  } });
});

test('every rejected QR outcome remains a normal response, never fake admission', async () => {
  for (const outcome of ['invalid', 'wrong_event', 'cancelled', 'refunded', 'already_used']) {
    scriptApi([[200, { outcome, ticket: null }]]);
    assert.equal((await checkInApi.scan(7, 'unusable')).outcome, outcome);
  }
});

test('manual admission and reversal address the selected event and escaped ticket code', async () => {
  const fake = scriptApi([[200, { outcome: 'valid', ticket }], [200, ticket]]);
  await checkInApi.admit(7, ticket.public_code);
  await checkInApi.reverse(7, ticket.public_code, 'Door 2');
  assert.deepEqual(fake.calls, [
    { method: 'POST', path: '/staff/events/7/tickets/T-A%2FB/check-in', body: { device_info: null } },
    { method: 'POST', path: '/staff/events/7/tickets/T-A%2FB/reverse', body: { device_info: 'Door 2' } },
  ]);
});

test('staff permission errors and reversal conflicts propagate for explicit UI handling', async () => {
  scriptApi([[403, { detail: 'You are not assigned to this event' }]]);
  await assert.rejects(checkInApi.attendance(9), (error) => error.status === 403);
  scriptApi([[409, { detail: 'This ticket is not checked in' }]]);
  await assert.rejects(checkInApi.reverse(7, 'T-1'), (error) => error.status === 409);
  scriptApi([[401, { detail: 'Expired' }]]);
  await assert.rejects(checkInApi.scan(7, 'qr'), (error) => error.status === 401);
});

test('admin search passes the explicit page bounds and encoded title or slug query', async () => {
  const fake = scriptApi([[200, [event]]]);
  assert.deepEqual(await adminApi.events('  Private & Night  ', 21, 40), [event]);
  const url = new URL(fake.calls[0].path, 'https://example.test');
  assert.equal(url.pathname, '/admin/events');
  assert.deepEqual(Object.fromEntries(url.searchParams), { limit: '21', offset: '40', q: 'Private & Night' });
});

test('admin overview uses the live response and user suspension and reinstatement use the account routes', async () => {
  const overview = { users: 8, open_reports: 2, gross_minor: 50_000, is_simulated: true };
  const account = { id: 14, status: 'active' };
  const suspended = { ...account, status: 'suspended' };
  const fake = scriptApi([[200, overview], [200, [account]], [200, suspended], [200, account]]);
  assert.deepEqual(await adminApi.overview(), overview);
  assert.deepEqual(await adminApi.users('  Алия & Co  ', 21, 20), [account]);
  assert.deepEqual(await adminApi.suspendUser(14, '  Account review  '), suspended);
  assert.deepEqual(await adminApi.reinstateUser(14), account);
  const search = new URL(fake.calls[1].path, 'https://example.test');
  assert.equal(search.pathname, '/admin/users');
  assert.deepEqual(Object.fromEntries(search.searchParams), { limit: '21', offset: '20', q: 'Алия & Co' });
  assert.equal(fake.calls[0].path, '/admin/overview');
  assert.deepEqual(fake.calls.slice(2), [
    { method: 'POST', path: '/admin/users/14/suspend', body: { reason: 'Account review' } },
    { method: 'POST', path: '/admin/users/14/unsuspend', body: undefined },
  ]);
});

test('admin report review filters and pages server results and preserves the chosen resolution', async () => {
  const report = { id: 39, event_id: 7, status: 'open' };
  const resolved = { ...report, status: 'actioned', resolved_at: '2026-11-09T10:00:00Z' };
  const fake = scriptApi([[200, [report]], [200, [report, resolved]], [200, resolved]]);
  assert.deepEqual(await adminApi.reports('open', 21, 20), [report]);
  assert.deepEqual(await adminApi.reports(undefined, 21, 0), [report, resolved]);
  assert.deepEqual(await adminApi.resolveReport(39, 'actioned'), resolved);
  assert.deepEqual(fake.calls, [
    { method: 'GET', path: '/admin/reports?limit=21&offset=20&status=open', body: undefined },
    { method: 'GET', path: '/admin/reports?limit=21&offset=0', body: undefined },
    { method: 'POST', path: '/admin/reports/39/resolve', body: { status: 'actioned' } },
  ]);
});

test('admin transaction queries send supported filters and page bounds to the matching endpoints', async () => {
  const page = { limit: 21, offset: 40 };
  const orders = [{ order_number: 'BF-A', status: 'partially_refunded' }];
  const payments = [{ id: 4, status: 'failed', is_simulated: true }];
  const refunds = [{ id: 7, status: 'succeeded' }];
  const fake = scriptApi([[200, orders], [200, payments], [200, refunds]]);
  assert.deepEqual(await adminApi.orders(page, '  Билет & Co  '), orders);
  assert.deepEqual(await adminApi.payments(page, 'failed'), payments);
  assert.deepEqual(await adminApi.refunds(page), refunds);
  assert.deepEqual(fake.calls.map(({ method, path }) => {
    const url = new URL(path, 'https://example.test');
    return [method, url.pathname, Object.fromEntries(url.searchParams)];
  }), [
    ['GET', '/admin/orders', { limit: '21', offset: '40', q: 'Билет & Co' }],
    ['GET', '/admin/payments', { limit: '21', offset: '40', status: 'failed' }],
    ['GET', '/admin/refunds', { limit: '21', offset: '40' }],
  ]);
});

test('activation and campaign monitoring use their own paginated data sources', async () => {
  const activation = { event_id: 12, status: 'suspended', fee_paid: true };
  const campaign = { id: 6, event_id: 12, redemptions: 7, discount_minor: 17_500 };
  const fake = scriptApi([[200, [activation]], [200, [campaign]]]);
  const page = { limit: 21, offset: 20 };
  assert.deepEqual(await adminApi.activations(page), [activation]);
  assert.deepEqual(await adminApi.campaigns(page), [campaign]);
  assert.deepEqual(fake.calls.map(({ path }) => path), [
    '/admin/activations?limit=21&offset=20', '/admin/campaigns?limit=21&offset=20',
  ]);
  assert.notDeepEqual(operationsKeys.adminRecords(1, 'campaigns'), operationsKeys.adminRecords(2, 'campaigns'));
});

test('fee updates send only edited values as tiyn and basis points, including zero', async () => {
  const initial = { activation_fee_minor: 500_000, processing_fee_bps: 250 };
  const saved = { ...initial, processing_fee_bps: 0 };
  const fake = scriptApi([[200, initial], [200, saved]]);
  assert.deepEqual(await adminApi.settings(), initial);
  const draft = readFeeDraft({ activation_fee_minor: '5000,00', processing_fee_bps: '0' }, initial);
  assert.deepEqual(draft, { changes: { processing_fee_bps: 0 }, invalid: [], dirty: true });
  assert.deepEqual(await adminApi.updateSettings(draft.changes), saved);
  assert.deepEqual(fake.calls, [
    { method: 'GET', path: '/admin/settings', body: undefined },
    { method: 'PUT', path: '/admin/settings', body: { processing_fee_bps: 0 } },
  ]);
  assert.deepEqual(readFeeDraft({ activation_fee_minor: '7200,01', processing_fee_bps: '2.75' }, initial).changes,
    { activation_fee_minor: 720_001, processing_fee_bps: 275 });
});

test('fee entry respects the API ceilings and rejects rounded or exponential values', () => {
  const current = { activation_fee_minor: 500_000, processing_fee_bps: 250 };
  assert.deepEqual(readFeeDraft({ activation_fee_minor: '1000000', processing_fee_bps: '20,00' }, current).changes,
    { activation_fee_minor: 100_000_000, processing_fee_bps: 2_000 });
  for (const input of ['', '-1', '1e1', '1.005', '20.01']) {
    assert.deepEqual(readFeeDraft({ processing_fee_bps: input }, current).invalid, ['processing_fee_bps']);
  }
  assert.deepEqual(readFeeDraft({ activation_fee_minor: '1000000.01' }, current).invalid, ['activation_fee_minor']);
});

test('admin detail resolves non-public events via the slug-hinted authorized list', async () => {
  const fake = scriptApi([[200, [{ ...event, id: 8 }, event]]]);
  assert.deepEqual(await adminApi.event(7, 'private-night'), event);
  assert.equal(fake.calls[0].path, '/admin/events?limit=100&offset=0&q=private-night');
});

test('plain admin detail links page the authorized list, and stale slug hints fall back', async () => {
  const page = Array.from({ length: 100 }, (_, i) => ({ ...event, id: 200 - i }));
  const fake = scriptApi([[200, []], [200, page], [200, [event]]]);
  assert.deepEqual(await adminApi.event(7, 'old-slug'), event);
  assert.deepEqual(fake.calls.map((call) => call.path), [
    '/admin/events?limit=100&offset=0&q=old-slug', '/admin/events?limit=100&offset=0', '/admin/events?limit=100&offset=100',
  ]);
  scriptApi([[200, []]]);
  await assert.rejects(adminApi.event(999), (error) => error.status === 404);
});

test('missing activation is empty only for the specific no-record response', async () => {
  scriptApi([[404, { detail: 'This event has no activation record' }]]);
  assert.equal(await adminApi.activation(7), null);
  scriptApi([[404, { detail: 'Event not found' }]]);
  await assert.rejects(adminApi.activation(7), (error) => error.status === 404);
  scriptApi([[403, { detail: 'Platform admins only' }]]);
  await assert.rejects(adminApi.activation(7), (error) => error.status === 403);
});

test('admin event and paid-sales mutations use distinct routes and preserve reasons', async () => {
  const fake = scriptApi(Array.from({ length: 5 }, () => [200, event]));
  await adminApi.transition(7, 'suspend', '  Review fraud report  ');
  await adminApi.transition(7, 'unsuspend');
  await adminApi.transition(7, 'cancel');
  await adminApi.transitionActivation(7, 'suspend', '  Payment review  ');
  await adminApi.transitionActivation(7, 'reinstate');
  assert.deepEqual(fake.calls, [
    { method: 'POST', path: '/admin/events/7/suspend', body: { reason: 'Review fraud report' } },
    { method: 'POST', path: '/admin/events/7/unsuspend', body: undefined },
    { method: 'POST', path: '/admin/events/7/cancel', body: { reason: null } },
    { method: 'POST', path: '/admin/events/7/activation/suspend', body: { reason: 'Payment review' } },
    { method: 'POST', path: '/admin/events/7/activation/reinstate', body: undefined },
  ]);
});

test('admin timeline reads are bounded and failed mutations are never retried by adapters', async () => {
  const fake = scriptApi([[200, []], [409, { detail: 'the event is already cancelled' }]]);
  await adminApi.timeline(7, 26, 50);
  await assert.rejects(adminApi.transition(7, 'cancel'), (error) => error.status === 409);
  assert.equal(fake.calls[0].path, '/admin/events/7/timeline?limit=26&offset=50');
  assert.equal(fake.calls.length, 2);
});

test('door and moderation controls follow the server state machines', () => {
  assert.equal(ticketAction(ticket), 'admit');
  assert.equal(ticketAction({ ...ticket, status: 'checked_in' }), 'reverse');
  for (const status of ['cancelled', 'refunded', 'unknown']) assert.equal(ticketAction({ ...ticket, status }), null);
  assert.deepEqual(eventModerationActions('published'), ['suspend', 'cancel']);
  assert.deepEqual(eventModerationActions('suspended'), ['unsuspend', 'cancel']);
  assert.deepEqual(eventModerationActions('draft'), ['cancel']);
  assert.deepEqual(eventModerationActions('cancelled'), []);
  assert.equal(activationModerationAction('active'), 'suspend');
  assert.equal(activationModerationAction('suspended'), 'reinstate');
  assert.equal(activationModerationAction('pending'), null);
});

test('operations caches isolate accounts and mutation invalidation prefixes cover all pages', () => {
  assert.notDeepEqual(operationsKeys.staffEvents(1), operationsKeys.staffEvents(2));
  assert.notDeepEqual(operationsKeys.adminEvent(1, 7), operationsKeys.adminEvent(2, 7));
  assert.notDeepEqual(operationsKeys.attendance(1, 7), operationsKeys.attendance(2, 7));
  const prefix = operationsKeys.timelines(1, 7);
  assert.deepEqual(operationsKeys.timeline(1, 7, 4).slice(0, prefix.length), prefix);
  const listPrefix = operationsKeys.adminLists(1);
  assert.deepEqual(operationsKeys.adminList(1, 'night', 5).slice(0, listPrefix.length), listPrefix);
  const reportsPrefix = operationsKeys.adminReports(1);
  assert.deepEqual(operationsKeys.adminReportList(1, 'open', 4).slice(0, reportsPrefix.length), reportsPrefix);
  assert.notDeepEqual(operationsKeys.adminUserList(1, 'Ali', 0), operationsKeys.adminUserList(2, 'Ali', 0));
});

test('route IDs reject malformed and unsafe values before making requests', () => {
  assert.equal(validEventId('7'), 7);
  for (const input of [undefined, '', '0', '-1', '1.2', '1e2', 'abc', '9007199254740992']) assert.equal(validEventId(input), null);
});
