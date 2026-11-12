const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load(path) {
  const source = fs.readFileSync(require.resolve(path), 'utf8')
    .replace("import { API_V1_URL } from '@/constants/api';", "const API_V1_URL = 'https://api.example.test/api/v1';");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', compiled)(mod.exports, mod);
  return mod.exports;
}
const { accountApi, accountResponse } = load('../src/shared/api/account.ts');
const { notificationsApi } = load('../src/shared/api/notifications.ts');

test('profile updates only send editable fields and normalize empty phone', async () => {
  let payload;
  const fetcher = async (path, init) => { assert.equal(path, '/users/me'); payload = JSON.parse(init.body); return Response.json({ id: 7 }); };
  await accountApi.update(fetcher, ' QA ', ' User ', ' ', 'kk');
  assert.deepEqual(payload, { first_name: 'QA', last_name: 'User', phone: null, locale: 'kk' });
  assert.equal('is_platform_admin' in payload, false);
  await assert.rejects(accountApi.update(fetcher, ' ', 'User', '', 'en'), /first and last name/);
});

test('empty success responses from account confirmation are accepted', async () => {
  assert.equal(await accountResponse(new Response(null, { status: 204 })), null);
});

test('expired verification links retain the server explanation', async () => {
  await assert.rejects(accountResponse(Response.json({ detail: 'This link is invalid or has expired' }, { status: 400 })), /expired/);
});

test('notification read errors stay visible and are not silently retried', async () => {
  let calls = 0;
  await assert.rejects(notificationsApi.markRead(async () => { calls++; return Response.json({}, { status: 503 }); }), /Could not mark/);
  assert.equal(calls, 1);
});

test('notification feed uses the signed-in API and preserves unread count', async () => {
  const controller = new AbortController();
  const feed = await notificationsApi.list(async (path, init) => {
    assert.equal(path, '/users/me/notifications'); assert.equal(init.signal, controller.signal);
    return Response.json({ unread: 2, items: [] });
  }, controller.signal);
  assert.equal(feed.unread, 2);
});
