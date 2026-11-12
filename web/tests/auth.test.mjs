import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { moduleUrl } from './harness.mjs';

const source = await readFile(new URL('../src/shared/api/auth.ts', import.meta.url), 'utf8');
let moduleId = 0;
const user = { id: 1, email: 'test@example.com', first_name: 'Test', last_name: 'User' };
const tokens = { access_token: 'access-1', csrf_token: 'csrf-1' };
const credentials = { email: user.email, password: 'password123' };

async function setup(responses, storedCsrf) {
  const storage = new Map(storedCsrf ? [['biletflow.auth.csrf', storedCsrf]] : []);
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  globalThis.window = new EventTarget();
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, ...init });
    assert.ok(responses.length, `Unexpected request to ${url}`);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (next instanceof Response) return next;
    const [status, body] = next;
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  };
  const { outputText } = ts.transpileModule(
    source.replace('import.meta.env.VITE_API_URL', 'undefined'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
  );
  const authUrl = `data:text/javascript;base64,${Buffer.from(outputText + `\n//# sourceURL=auth-test-${moduleId++}.js`).toString('base64')}`;
  return { ...await import(authUrl), authUrl, calls, storage };
}

test('guests do not make unauthenticated profile requests', async () => {
  const { authApi, calls } = await setup([]);
  assert.equal(await authApi.currentUser(), null);
  assert.equal(calls.length, 0);
});

test('login sends JSON, authenticates the profile, and persists only CSRF', async () => {
  const { authApi, calls, storage } = await setup([[200, tokens], [200, user]]);
  assert.deepEqual(await authApi.login(credentials), user);
  assert.deepEqual(JSON.parse(calls[0].body), credentials);
  assert.equal(calls[0].headers.get('Content-Type'), 'application/json');
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer access-1');
  assert.ok(calls.every(call => call.credentials === 'include'));
  assert.deepEqual([...storage.values()], ['csrf-1']);
});

test('restores a session using the persisted CSRF proof and rotates it', async () => {
  const { authApi, calls, storage } = await setup([[200, tokens], [200, user]], 'old-csrf');
  assert.deepEqual(await authApi.currentUser(), user);
  assert.ok(calls[0].url.endsWith('/auth/refresh'));
  assert.equal(calls[0].headers.get('X-CSRF-Token'), 'old-csrf');
  assert.equal(calls[0].body, undefined);
  assert.equal(storage.get('biletflow.auth.csrf'), 'csrf-1');
});

test('retries an expired access token once with refreshed credentials', async () => {
  const { authApi, calls } = await setup([
    [200, tokens], [200, user], [401, {}],
    [200, { access_token: 'access-2', csrf_token: 'csrf-2' }], [200, user],
  ]);
  await authApi.login(credentials);
  assert.deepEqual(await authApi.currentUser(), user);
  assert.equal(calls[3].headers.get('X-CSRF-Token'), 'csrf-1');
  assert.equal(calls[4].headers.get('Authorization'), 'Bearer access-2');
});

test('parallel session checks share one refresh request', async () => {
  const { authApi, calls } = await setup([[200, tokens], [200, user], [200, user]], 'csrf-old');
  assert.deepEqual(await Promise.all([authApi.currentUser(), authApi.currentUser()]), [user, user]);
  assert.equal(calls.filter(call => call.url.endsWith('/auth/refresh')).length, 1);
});

for (const status of [401, 403]) {
  test(`refresh rejection (${status}) clears the local session`, async () => {
    const { authApi, storage } = await setup([[status, { detail: 'Invalid session' }]], 'expired');
    assert.equal(await authApi.currentUser(), null);
    assert.equal(storage.size, 0);
  });
}

test('network errors preserve the session so the user can retry', async () => {
  const { authApi, storage } = await setup([new TypeError('Failed to fetch')], 'csrf-old');
  await assert.rejects(authApi.currentUser(), /Failed to fetch/);
  assert.equal(storage.get('biletflow.auth.csrf'), 'csrf-old');
});

test('logout authenticates the server request and clears the session', async () => {
  const { authApi, calls, storage } = await setup([[200, tokens], [200, user], [204]]);
  await authApi.login(credentials);
  await authApi.logout();
  assert.equal(calls[2].headers.get('Authorization'), 'Bearer access-1');
  assert.equal(storage.size, 0);
  assert.equal(await authApi.currentUser(), null);
});

test('failed logout retains credentials for retry', async () => {
  const { authApi, storage } = await setup([[200, tokens], [200, user], [500, {}]]);
  await authApi.login(credentials);
  await assert.rejects(authApi.logout());
  assert.equal(storage.get('biletflow.auth.csrf'), 'csrf-1');
});

test('registration maps backend validation errors to form fields', async () => {
  const { authApi } = await setup([[422, { detail: [{ loc: ['body', 'email'], msg: 'Invalid email' }] }]]);
  await assert.rejects(authApi.register({}), error => {
    assert.equal(error.fieldErrors.email, 'Invalid email');
    return true;
  });
});

test('guest ticket PDFs and the public calendar keep their file contents and guest link', async () => {
  const { authUrl, calls } = await setup([
    new Response('%PDF-order', { headers: { 'Content-Type': 'application/pdf' } }),
    new Response('%PDF-ticket', { headers: { 'Content-Type': 'application/pdf' } }),
    new Response('BEGIN:VCALENDAR', { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } }),
  ]);
  const { eventsApi, ordersApi } = await import(await moduleUrl('../src/shared/api/events.ts', {
    '"./auth"': JSON.stringify(authUrl),
  }));
  const token = 'guest+&/?';
  assert.equal(await (await ordersApi.ticketsPdf('BF-ORDER', token)).text(), '%PDF-order');
  assert.equal(await (await ordersApi.ticketsPdf('BF-ORDER', token, 'BF-TICKET')).text(), '%PDF-ticket');
  assert.equal(await (await eventsApi.calendar('jazz-night')).text(), 'BEGIN:VCALENDAR');
  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    '/api/v1/orders/BF-ORDER/tickets.pdf',
    '/api/v1/orders/BF-ORDER/tickets/BF-TICKET.pdf',
    '/api/v1/events/jazz-night/calendar.ics',
  ]);
  assert.equal(new URL(calls[0].url).searchParams.get('token'), token);
  assert.equal(new URL(calls[1].url).searchParams.get('token'), token);
  assert.ok(calls.every(call => !call.headers.has('Authorization')));
});

test('event reports accept guests and attach the signed-in session when available', async () => {
  const accepted = { detail: 'Report accepted' };
  const { authApi, authUrl, calls } = await setup([[202, accepted], [200, tokens], [200, user], [202, accepted]]);
  const { eventsApi } = await import(await moduleUrl('../src/shared/api/events.ts', {
    '"./auth"': JSON.stringify(authUrl),
  }));
  assert.deepEqual(await eventsApi.report('weekend-event', 'duplicate', '  '), accepted);
  await authApi.login(credentials);
  await eventsApi.report('weekend-event', 'misleading', '  Venue description differs  ');
  const guest = calls[0];
  const signedIn = calls.at(-1);
  assert.ok([guest, signedIn].every(call => call.method === 'POST' && new URL(call.url).pathname === '/api/v1/events/weekend-event/report'));
  assert.equal(guest.headers.get('Authorization'), null);
  assert.deepEqual(JSON.parse(guest.body), { reason: 'duplicate', details: null });
  assert.equal(signedIn.headers.get('Authorization'), 'Bearer access-1');
  assert.deepEqual(JSON.parse(signedIn.body), { reason: 'misleading', details: 'Venue description differs' });
});

test('the signed-in order owner can download a PDF after access-token refresh', async () => {
  const { authApi, authUrl, calls } = await setup([
    [200, tokens], [200, user], [401, {}], [200, { access_token: 'access-2', csrf_token: 'csrf-2' }],
    new Response('%PDF-ticket', { headers: { 'Content-Type': 'application/pdf' } }),
  ]);
  const { ordersApi } = await import(await moduleUrl('../src/shared/api/events.ts', {
    '"./auth"': JSON.stringify(authUrl),
  }));
  await authApi.login(credentials);
  assert.equal(await (await ordersApi.ticketsPdf('BF-ORDER', null)).text(), '%PDF-ticket');
  assert.equal(calls.at(-1).headers.get('Authorization'), 'Bearer access-2');
  assert.equal(calls.at(-1).headers.get('Accept'), 'application/pdf');
  assert.equal(new URL(calls.at(-1).url).search, '');
});

test('download errors preserve the API status and reject an unexpected file type', async () => {
  const { optionalAuthFile, publicFile } = await setup([
    [404, { detail: 'No valid ticket to print' }],
    new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }),
  ]);
  await assert.rejects(optionalAuthFile('/orders/BF-ORDER/tickets.pdf', 'application/pdf'), {
    status: 404, message: 'No valid ticket to print',
  });
  await assert.rejects(publicFile('/events/jazz/calendar.ics', 'text/calendar'), { status: 502 });
});

test('attendee CSV downloads use the organizer session and preserve the original UTF-8 bytes', async () => {
  const bytes = new TextEncoder().encode('\uFEFFticket,name\r\nBF-TEST,Әлия\r\n');
  const { authApi, authUrl, calls } = await setup([
    [200, tokens], [200, user], new Response(bytes, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } }),
  ]);
  const { eventReportsApi } = await import(await moduleUrl('../src/shared/api/eventReports.ts', {
    '"./auth"': JSON.stringify(authUrl),
  }));
  await authApi.login(credentials);
  const csv = await eventReportsApi.attendeesCsv(7);
  assert.deepEqual(new Uint8Array(await csv.arrayBuffer()), bytes);
  assert.equal(calls.at(-1).headers.get('Authorization'), 'Bearer access-1');
  assert.equal(new URL(calls.at(-1).url).pathname, '/api/v1/organizer/events/7/attendees.csv');
});

test('admin CSV downloads preserve the file bytes and use authenticated export endpoints', async () => {
  const orders = new TextEncoder().encode('\uFEFForder,buyer\r\nBF-1,Әлия\r\n');
  const payments = new TextEncoder().encode('\uFEFFid,status\r\n4,failed\r\n');
  const csv = (bytes) => new Response(bytes, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
  const { authApi, authUrl, calls } = await setup([[200, tokens], [200, user], csv(orders), csv(payments)]);
  const { adminApi } = await import(await moduleUrl('../src/shared/api/admin.ts', { '"./auth"': JSON.stringify(authUrl) }));
  await authApi.login(credentials);
  for (const [download, expected] of [[adminApi.ordersCsv, orders], [adminApi.paymentsCsv, payments]]) {
    assert.deepEqual(new Uint8Array(await (await download()).arrayBuffer()), expected);
  }
  const exports = calls.slice(2);
  assert.deepEqual(exports.map(({ url }) => new URL(url).pathname), [
    '/api/v1/admin/exports/orders.csv', '/api/v1/admin/exports/payments.csv',
  ]);
  assert.ok(exports.every(({ headers }) => headers.get('Authorization') === 'Bearer access-1' && headers.get('Accept') === 'text/csv'));
});

test('promo quote and checkout submit the campaign token with the current basket', async () => {
  const quote = { code: 'JAZZ20', subtotal_minor: 100_000, discount_minor: 20_000, total_minor: 80_000 };
  const { authUrl, calls } = await setup([[200, quote], [201, { status: 'pending' }]]);
  const replacements = { '"./auth"': JSON.stringify(authUrl) };
  const { campaignsApi } = await import(await moduleUrl('../src/shared/api/campaigns.ts', replacements));
  const { ordersApi } = await import(await moduleUrl('../src/shared/api/events.ts', replacements));
  const signal = new AbortController().signal;
  const items = [{ ticket_type_id: 5, quantity: 2 }];
  assert.deepEqual(await campaignsApi.quote('jazz', { kind: 'token', value: 'campaign-token' }, items, signal), quote);
  assert.equal(calls[0].signal, signal);
  assert.deepEqual(JSON.parse(calls[0].body), { token: 'campaign-token', items });
  const input = {
    contact_name: 'Test Buyer', contact_email: 'buyer@example.com', campaign_token: 'campaign-token',
    items: [{ ticket_type_id: 5, attendees: [{ full_name: 'Test Buyer' }, { full_name: 'Test Guest' }] }],
  };
  assert.deepEqual(await ordersApi.checkout('jazz', input), { status: 'pending' });
  assert.deepEqual(JSON.parse(calls[1].body), input);
  assert.ok(calls[1].url.endsWith('/events/jazz/orders'));
});
