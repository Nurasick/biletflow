import assert from 'node:assert/strict';
import test from 'node:test';

import { fakeAuthUrl, moduleUrl, scriptApi } from './harness.mjs';

const auth = { '"./auth"': JSON.stringify(fakeAuthUrl) };
const { adminApi } = await import(await moduleUrl('../src/shared/api/admin.ts', auth));
const supportUrl = await moduleUrl('../src/shared/api/support.ts', auth);
const { staffSupportApi, supportApi, audienceCategories, caseCategories } = await import(supportUrl);
const { notificationsApi } = await import(await moduleUrl('../src/shared/api/notifications.ts', auth));
const { queueFilters, queueSearch, attachmentProblem } = await import(await moduleUrl(
  '../src/features/Support/model/supportModel.ts', { '"../../../shared/api/support"': JSON.stringify(supportUrl) },
));
const { zonedWallClockToIso, adminTimelineRange } = await import(
  await moduleUrl('../src/features/Operations/model/operationsModel.ts'),
);
const { decodeSize } = await import(await moduleUrl('../src/features/Operations/model/qrReader.ts'));
const { pageTitleKey, documentTitle } = await import(await moduleUrl('../src/shared/Layout/pageTitle.ts'));

const page = { limit: 21, offset: 20 };
const query = (call) => Object.fromEntries(new URL(call.path, 'https://app.example').searchParams);
const caseNumber = 'SC-261124-ABC123';

test('admin payment search sends the query with the status and paging', async () => {
  const fake = scriptApi([[200, []], [200, []]]);
  await adminApi.payments(page, 'failed', '  BF-ORDER-1 ');
  await adminApi.payments(page);
  assert.equal(new URL(fake.calls[0].path, 'https://app.example').pathname, '/admin/payments');
  assert.deepEqual(query(fake.calls[0]), { limit: '21', offset: '20', q: 'BF-ORDER-1', status: 'failed' });
  assert.deepEqual(query(fake.calls[1]), { limit: '21', offset: '20' });
});

test('admin events, campaigns and activations pass their filters', async () => {
  const fake = scriptApi([[200, []], [200, []], [200, []], [200, []]]);
  await adminApi.events('jazz', 21, 0, undefined, 'suspended');
  await adminApi.campaigns(page, 'SPRING', false);
  await adminApi.campaigns(page);
  await adminApi.activations(page, 'pending');
  assert.deepEqual(query(fake.calls[0]), { limit: '21', offset: '0', q: 'jazz', status: 'suspended' });
  assert.deepEqual(query(fake.calls[1]), { limit: '21', offset: '20', q: 'SPRING', is_active: 'false' });
  assert.deepEqual(query(fake.calls[2]), { limit: '21', offset: '20' });
  assert.deepEqual(query(fake.calls[3]), { limit: '21', offset: '20', status: 'pending' });
});

test('every admin CSV export asks for text/csv and carries only the filters that are set', async () => {
  const kinds = ['orders', 'payments', 'refunds', 'users', 'events', 'activations'];
  const fake = scriptApi(kinds.map(() => [200, new Blob()]).concat([[200, new Blob()], [200, new Blob()]]));
  for (const kind of kinds) await adminApi.exportCsv(kind);
  await adminApi.exportCsv('events', { query: ' gala ', status: 'published' });
  await adminApi.ordersCsv();
  assert.deepEqual(fake.calls.slice(0, kinds.length).map(({ method, path, body }) => [method, path, body.mediaType]),
    kinds.map((kind) => ['FILE', `/admin/exports/${kind}.csv`, 'text/csv']));
  assert.equal(fake.calls[6].path, '/admin/exports/events.csv?q=gala&status=published');
  assert.equal(fake.calls[7].path, '/admin/exports/orders.csv');
});

test('disputes are listed with filters, opened, and updated with only the changed fields', async () => {
  const dispute = { id: 4, status: 'open' };
  const fake = scriptApi([[200, [dispute]], [201, dispute], [200, { ...dispute, status: 'closed' }]]);
  assert.deepEqual(await adminApi.disputes(page, 'open', 'BF-1'), [dispute]);
  await adminApi.openDispute({ order_number: 'BF-1', reason: 'Card holder claims no delivery.', amount_minor: 250000 });
  await adminApi.updateDispute(4, { status: 'closed', resolution_notes: 'Refunded outside the platform.' });
  assert.deepEqual(query(fake.calls[0]), { limit: '21', offset: '20', q: 'BF-1', status: 'open' });
  assert.deepEqual(fake.calls.slice(1).map(({ method, path, body }) => [method, path, body]), [
    ['POST', '/admin/disputes', { order_number: 'BF-1', reason: 'Card holder claims no delivery.', amount_minor: 250000 }],
    ['PATCH', '/admin/disputes/4', { status: 'closed', resolution_notes: 'Refunded outside the platform.' }],
  ]);
});

test('the admin timeline sends its date range only when one is set', async () => {
  const fake = scriptApi([[200, []], [200, []]]);
  await adminApi.timeline(9, 26, 0, undefined, { since: '2026-11-01T00:00:00.000Z' });
  await adminApi.timeline(9);
  assert.deepEqual(query(fake.calls[0]), { limit: '26', offset: '0', since: '2026-11-01T00:00:00.000Z' });
  assert.deepEqual(query(fake.calls[1]), { limit: '25', offset: '0' });
});

test('timeline dates are read in the event time zone, not the browser one', () => {
  assert.equal(zonedWallClockToIso('2026-11-24T10:00', 'Asia/Almaty'), '2026-11-24T05:00:00.000Z');
  assert.equal(zonedWallClockToIso('2026-07-01T12:30', 'Europe/London'), '2026-07-01T11:30:00.000Z');
  assert.equal(zonedWallClockToIso('2026-03-29T01:30', 'Europe/London'), null, 'skipped by the DST jump');
  assert.equal(zonedWallClockToIso('2026-02-30T10:00', 'UTC'), null);
  assert.equal(zonedWallClockToIso('not a date', 'UTC'), null);
  assert.deepEqual(adminTimelineRange('', '', 'UTC'), { range: {} });
  assert.deepEqual(adminTimelineRange('2026-11-02T00:00', '2026-11-01T00:00', 'UTC'), { error: 'invalidRange' });
  assert.deepEqual(adminTimelineRange('2026-13-01T00:00', '', 'UTC'), { error: 'invalidDate' });
  assert.deepEqual(adminTimelineRange('2026-11-01T00:00', '', 'Asia/Almaty'), { range: { since: '2026-10-31T19:00:00.000Z' } });
});

test('requesters only see the categories that fit who they are asking', () => {
  assert.ok(caseCategories.includes('activation'));
  assert.ok(!audienceCategories.attendee.includes('activation'));
  assert.deepEqual([...audienceCategories.organizer], ['account', 'activation', 'payment', 'technical']);
  for (const list of Object.values(audienceCategories)) for (const category of list) assert.ok(caseCategories.includes(category));
});

test('queue filters round-trip through the URL, including audience, escalation and search', async () => {
  const params = new URLSearchParams('status=open&audience=attendee&escalated=true&q=%20guest%40example.com%20&event_id=7&page=3');
  const filters = queueFilters(params);
  assert.deepEqual(filters, {
    status: 'open', category: undefined, eventId: 7, audience: 'attendee', escalated: true, query: 'guest@example.com',
  });
  assert.equal(queueSearch(filters, 2).toString(), 'status=open&event_id=7&audience=attendee&escalated=true&q=guest%40example.com&page=3');
  assert.deepEqual(queueFilters(new URLSearchParams('audience=everyone&escalated=yes')).audience, undefined);
  assert.equal(queueFilters(new URLSearchParams('escalated=yes')).escalated, undefined);

  const fake = scriptApi([[200, []]]);
  await staffSupportApi.queue(filters, 21, 40);
  assert.deepEqual(query(fake.calls[0]), {
    limit: '21', offset: '40', status: 'open', event_id: '7', audience: 'attendee', escalated: 'true', q: 'guest@example.com',
  });
});

test('staff escalate with a trimmed reason and attach files to the case', async () => {
  const fake = scriptApi([[200, { is_escalated: true }], [201, { id: 3 }], [201, { id: 4 }], [200, new Blob()]]);
  await staffSupportApi.escalate(caseNumber, '  Payment provider issue  ');
  await staffSupportApi.attach(caseNumber, { filename: 'receipt.png', dataUrl: 'data:image/png;base64,AA==' });
  await staffSupportApi.attach(caseNumber, { filename: 'note.pdf', dataUrl: 'data:application/pdf;base64,AA==', messageId: 12 });
  await staffSupportApi.attachmentFile(caseNumber, 3, 'image/png');
  assert.deepEqual(fake.calls.map(({ method, path, body }) => [method, path, body]), [
    ['POST', `/staff/support/cases/${caseNumber}/escalate`, { reason: 'Payment provider issue' }],
    ['POST', `/staff/support/cases/${caseNumber}/attachments`, { filename: 'receipt.png', data_url: 'data:image/png;base64,AA==' }],
    ['POST', `/staff/support/cases/${caseNumber}/attachments`,
      { filename: 'note.pdf', data_url: 'data:application/pdf;base64,AA==', support_message_id: 12 }],
    ['FILE', `/staff/support/cases/${caseNumber}/attachments/3`, { mediaType: 'image/png' }],
  ]);
});

test('guest requesters attach and download through the signed case link', async () => {
  const token = 'case&token=+/';
  const fake = scriptApi([[201, { id: 8 }], [200, new Blob()]]);
  await supportApi.attach(caseNumber, token, { filename: 'ticket.jpg', dataUrl: 'data:image/jpeg;base64,AA==' });
  await supportApi.attachmentFile(caseNumber, token, 8, 'image/jpeg');
  for (const call of fake.calls) assert.equal(new URL(call.path, 'https://app.example').searchParams.get('token'), token);
  assert.deepEqual(fake.calls.map(({ path }) => new URL(path, 'https://app.example').pathname), [
    `/support/cases/${caseNumber}/attachments`, `/support/cases/${caseNumber}/attachments/8`,
  ]);
});

test('attachments are checked for type and size before upload', () => {
  assert.equal(attachmentProblem({ type: 'image/png', size: 1024 }), null);
  assert.equal(attachmentProblem({ type: 'application/pdf', size: 2 * 1024 * 1024 }), null);
  assert.equal(attachmentProblem({ type: 'application/pdf', size: 2 * 1024 * 1024 + 1 }), 'support.attachmentSize');
  assert.equal(attachmentProblem({ type: 'image/png', size: 0 }), 'support.attachmentSize');
  assert.equal(attachmentProblem({ type: 'image/gif', size: 10 }), 'support.attachmentType');
  assert.equal(attachmentProblem({ type: '', size: 10 }), 'support.attachmentType');
});

test('one notification can be marked read on its own', async () => {
  const fake = scriptApi([[204, null]]);
  await notificationsApi.markOneRead(42);
  assert.deepEqual(fake.calls, [{ method: 'POST', path: '/users/me/notifications/42/read', body: undefined }]);
});

test('webcam frames are scaled down for the JavaScript QR decoder, never up', () => {
  assert.deepEqual(decodeSize(1920, 1080), { width: 640, height: 360 });
  assert.deepEqual(decodeSize(320, 240), { width: 320, height: 240 });
  assert.equal(decodeSize(0, 480), null);
});

test('every route has a page title and the document title names the app', () => {
  assert.equal(pageTitleKey('/'), 'catalogue.title');
  assert.equal(pageTitleKey('/admin/disputes'), 'adminDisputes.title');
  assert.equal(pageTitleKey('/admin/events/12'), 'pageTitle.adminEvent');
  assert.equal(pageTitleKey('/staff/support/'), 'support.queue', 'a trailing slash still matches');
  assert.equal(pageTitleKey('/organizer/events/5/analytics'), 'analytics.title');
  assert.equal(pageTitleKey('/nowhere'), null);
  assert.equal(documentTitle('Disputes'), 'Disputes · BiletFlow');
  assert.equal(documentTitle('  '), 'BiletFlow');
  assert.equal(documentTitle(null), 'BiletFlow');
});
