import assert from 'node:assert/strict';
import test from 'node:test';

import { fakeAuthUrl, moduleUrl, scriptApi } from './harness.mjs';

const apiUrl = await moduleUrl('../src/shared/api/eventReports.ts', { '"./auth"': JSON.stringify(fakeAuthUrl) });
const modelUrl = await moduleUrl('../src/features/Organizer/model/eventReportModel.ts');
const { eventReportsApi } = await import(apiUrl);
const { eventReportKeys, reportPage, timelineFilters, REPORT_PAGE_SIZE } = await import(modelUrl);

test('attendee reads preserve one row per ticket, null contacts, order and ticket status', async () => {
  const attendee = { public_code: 'BF-A', ticket_status: 'valid', ticket_type_name: 'General',
    order_number: 'ORDER-1', full_name: 'Alex', email: null, phone: null };
  const rows = [attendee, { ...attendee, public_code: 'BF-B', ticket_status: 'refunded' }];
  const fake = scriptApi([[200, rows]]);
  assert.deepEqual(await eventReportsApi.attendees(7, reportPage(0)), rows);
  assert.equal(fake.calls[0].path, '/organizer/events/7/attendees?limit=26&offset=0');
});

test('pagination probes one extra row while advancing by visible rows, including the sentinel next time', async () => {
  const all = Array.from({ length: 51 }, (_, index) => ({ public_code: `BF-${index}` }));
  scriptApi([[200, all.slice(0, 26)], [200, all.slice(25, 51)], [200, all.slice(50)]]);
  const visible = [];
  for (let page = 0; page < 3; page++) {
    const rows = await eventReportsApi.attendees(7, reportPage(page));
    assert.equal(rows.length > REPORT_PAGE_SIZE, page < 2);
    visible.push(...rows.slice(0, REPORT_PAGE_SIZE));
  }
  assert.deepEqual(visible, all);
});

test('timeline requests encode UTC bounds and repeat action params without losing literal characters', async () => {
  const entry = { id: 8, created_at: '2026-10-29T10:00:00Z', actor_user_id: null,
    action: 'event.published', entity_type: 'event', entity_id: 7, summary: 'Event published', payload: null };
  const fake = scriptApi([[200, [entry]]]);
  const filters = { since: '2026-10-01T10:00:00+05:00', until: '2026-11-01T00:00:00Z',
    actions: ['event.published', 'ticket.checked_in', 'future.action & value'] };
  assert.deepEqual(await eventReportsApi.timeline(7, filters, reportPage(2)), [entry]);
  const url = new URL(fake.calls[0].path, 'https://example.test');
  assert.equal(url.pathname, '/organizer/events/7/timeline');
  assert.equal(url.searchParams.get('limit'), '26');
  assert.equal(url.searchParams.get('offset'), '50');
  assert.equal(url.searchParams.get('since'), filters.since);
  assert.equal(url.searchParams.get('until'), filters.until);
  assert.deepEqual(url.searchParams.getAll('action'), filters.actions);
  scriptApi([[200, []]]);
  await eventReportsApi.timeline(7, { actions: [] }, reportPage(0));
  assert.equal(globalThis.__fakeApi.calls[0].path, '/organizer/events/7/timeline?limit=26&offset=0');
});

test('report errors propagate without silently retrying or returning cached personal data', async () => {
  for (const status of [401, 403, 404, 500]) {
    const fake = scriptApi([[status, { detail: 'Not available' }]]);
    await assert.rejects(eventReportsApi.attendees(7, reportPage(0)), (error) => error.status === status);
    assert.equal(fake.calls.length, 1);
  }
  scriptApi([[403, { detail: 'Not your event' }]]);
  await assert.rejects(eventReportsApi.timeline(7, { actions: [] }, reportPage(0)), (error) => error.status === 403);
});

test('both report requests forward the cancellation signal to authenticated transport', async () => {
  const captureUrl = `data:text/javascript;base64,${Buffer.from(`
    export const api = { get: async (path, init) => { globalThis.__reportRequest = { path, init }; return []; } };
  `).toString('base64')}`;
  const module = await moduleUrl('../src/shared/api/eventReports.ts', { '"./auth"': JSON.stringify(captureUrl) });
  const { eventReportsApi: reports } = await import(module);
  const controller = new AbortController();
  await reports.attendees(7, { ...reportPage(0), signal: controller.signal });
  assert.equal(globalThis.__reportRequest.init.signal, controller.signal);
  await reports.timeline(7, { actions: [] }, { ...reportPage(0), signal: controller.signal });
  assert.equal(globalThis.__reportRequest.init.signal, controller.signal);
  delete globalThis.__reportRequest;
});

test('local date filters convert to UTC, allow open bounds and reject invalid or reversed ranges', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'Asia/Almaty';
  try {
    assert.deepEqual(timelineFilters('2026-10-29T09:15', '2026-10-30T09:15', ['ticket.checked_in', 'event.published', 'event.published']), {
      filters: { since: '2026-10-29T04:15:00.000Z', until: '2026-10-30T04:15:00.000Z', actions: ['event.published', 'ticket.checked_in'] },
    });
    assert.deepEqual(timelineFilters('', '', []), { filters: { since: undefined, until: undefined, actions: [] } });
    assert.equal(timelineFilters('', '2026-10-29T09:15', []).error, undefined);
    assert.equal(timelineFilters('2026-10-29T09:15', '', []).error, undefined);
    for (const invalid of ['2026-02-30T10:00', '2026-13-01T10:00', '2026-10-29T24:00', '2026-10-29T10:60', '2026-10-29', 'invalid']) {
      assert.equal(timelineFilters(invalid, '', []).error, 'invalidDate', invalid);
    }
    assert.equal(timelineFilters('2026-10-29T09:15', '2026-10-29T09:15', []).error, 'invalidRange');
    assert.equal(timelineFilters('2026-10-30T09:15', '2026-10-29T09:15', []).error, 'invalidRange');
    process.env.TZ = 'America/New_York';
    assert.equal(timelineFilters('2026-03-08T02:30', '', []).error, 'invalidDate');
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('report cache keys isolate accounts, events, pages and applied filters', () => {
  const filters = { actions: [] };
  assert.notDeepEqual(eventReportKeys.attendees(1, 7, 0), eventReportKeys.attendees(2, 7, 0));
  assert.notDeepEqual(eventReportKeys.attendees(1, 7, 0), eventReportKeys.attendees(1, 8, 0));
  assert.notDeepEqual(eventReportKeys.attendees(1, 7, 0), eventReportKeys.attendees(1, 7, 1));
  assert.notDeepEqual(eventReportKeys.timeline(1, 7, filters, 0), eventReportKeys.timeline(2, 7, filters, 0));
  assert.notDeepEqual(eventReportKeys.timeline(1, 7, filters, 0), eventReportKeys.timeline(1, 8, filters, 0));
  assert.notDeepEqual(eventReportKeys.timeline(1, 7, filters, 0), eventReportKeys.timeline(1, 7, filters, 1));
  assert.notDeepEqual(eventReportKeys.timeline(1, 7, filters, 0), eventReportKeys.timeline(1, 7, { actions: ['event.published'] }, 0));
  assert.notDeepEqual(eventReportKeys.timeline(1, 7, filters, 0), eventReportKeys.timeline(1, 7, { since: '2026-10-29T00:00:00Z', actions: [] }, 0));
});
