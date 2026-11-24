import assert from 'node:assert/strict';
import test from 'node:test';

import { fakeAuthUrl, moduleUrl, scriptApi } from './harness.mjs';

const instantUrl = await moduleUrl('../src/shared/lib/parseApiInstant.ts');
const dateTimeUrl = await moduleUrl('../src/features/Organizer/model/eventDateTime.ts', {
  '"../../../shared/lib/parseApiInstant"': JSON.stringify(instantUrl),
});
const discoveryUrl = await moduleUrl('../src/features/Main/model/eventDiscovery.ts', {
  '"../../Organizer/model/eventDateTime"': JSON.stringify(dateTimeUrl),
});
const accessUrl = await moduleUrl('../src/shared/api/eventAccess.ts', {
  '"./auth"': JSON.stringify(fakeAuthUrl),
});

const { clearDiscovery, discoveryApiFilters, readDiscovery } = await import(discoveryUrl);
const { eventAccessApi, eventAccessHeaders } = await import(accessUrl);

test('URL discovery supports server-side pages and inclusive Almaty calendar dates', () => {
  const params = new URLSearchParams({
    q: 'Palace of Republic', category: 'concert', city: 'Almaty', price_type: 'paid', sort: 'newest',
    from: '2030-07-29', to: '2030-07-29', page: '3',
  });
  assert.deepEqual(discoveryApiFilters(readDiscovery(params)), {
    limit: 13,
    offset: 24,
    q: 'Palace of Republic',
    category: 'concert',
    city: 'Almaty',
    price_type: 'paid',
    sort: 'newest',
    starts_after: '2030-07-28T19:00:00.000Z',
    starts_before: '2030-07-29T19:00:00.000Z',
  });
});

test('malformed public URLs fall back to valid filters and clearing preserves unrelated parameters', () => {
  const params = new URLSearchParams('category=junk&from=2030-02-30&to=2026-01-01&price_type=cheap&sort=junk&page=-2&campaign=abc');
  const filters = discoveryApiFilters(readDiscovery(params));
  assert.equal(filters.sort, 'soonest');
  assert.equal(filters.offset, 0);
  assert.equal(filters.category, undefined);
  assert.equal(filters.price_type, undefined);
  assert.equal(filters.starts_after, undefined);
  assert.equal(filters.starts_before, '2026-01-01T19:00:00.000Z');
  assert.equal(clearDiscovery(params).toString(), 'campaign=abc');
});

test('private event credentials are exchanged in a POST body and used as a request header', async () => {
  const result = { event_slug: 'invite-only', access_token: 'access-token' };
  const api = scriptApi([[200, result], [200, result]]);
  const code = { access_code: 'secret' };
  const invite = { invite_token: 'signed-invite' };
  assert.deepEqual(await eventAccessApi.unlock('invite-only', code), result);
  assert.deepEqual(await eventAccessApi.unlock('invite-only', invite), result);
  assert.deepEqual(api.calls, [
    { method: 'POST', path: '/events/invite-only/unlock', body: code },
    { method: 'POST', path: '/events/invite-only/unlock', body: invite },
  ]);
  assert.deepEqual(eventAccessHeaders(result.access_token), { 'X-Event-Access-Token': 'access-token' });
  assert.deepEqual(eventAccessHeaders(), {});
});
