import assert from 'node:assert/strict';
import test from 'node:test';

import { fakeAuthUrl, moduleUrl, scriptApi } from './harness.mjs';

const schemaUrl = await moduleUrl('../src/features/Account/model/accountSchema.ts', {
  '"zod"': JSON.stringify(import.meta.resolve('zod')),
});
// Keep the existing scripted transport, recording the signal passed through
// the authenticated request so account switches can cancel a pending save.
const accountAuthUrl = `data:text/javascript;base64,${Buffer.from(`
  export * from ${JSON.stringify(fakeAuthUrl)};
  import { rawRequest } from ${JSON.stringify(fakeAuthUrl)};
  export const authenticatedRequest = (path, init) => {
    globalThis.__accountRequestInit = init;
    return rawRequest(path, init);
  };
`).toString('base64')}`;
const apiUrl = await moduleUrl('../src/shared/api/account.ts', { '"./auth"': JSON.stringify(accountAuthUrl) });
const { accountSchema, accountValues } = await import(schemaUrl);
const { accountApi } = await import(apiUrl);

const USER = {
  id: 7, email: 'me@example.com', first_name: 'Aida', last_name: 'Alimova',
  phone: null, locale: 'kk', is_organizer: true, is_platform_admin: false,
};
const VALUES = { first_name: 'Aida', last_name: 'Alimova', phone: '', locale: 'kk' };

test('account values hydrate nullable phone and keep supported saved language', () => {
  assert.deepEqual(accountValues(USER), VALUES);
  assert.equal(accountValues({ ...USER, locale: 'ru' }).locale, 'ru');
  assert.equal(accountValues({ ...USER, locale: 'en' }).locale, 'en');
  assert.equal(accountValues({ ...USER, locale: 'unsupported' }).locale, 'kk');
});

test('account validation trims fields and accepts the backend length boundaries', () => {
  assert.deepEqual(accountSchema.parse({
    ...VALUES, first_name: '  Aida  ', last_name: ' Alimova ', phone: ' +77001234567 ',
  }), { ...VALUES, phone: '+77001234567' });
  assert.equal(accountSchema.safeParse({
    ...VALUES, first_name: 'a'.repeat(100), last_name: 'b'.repeat(100), phone: '1'.repeat(32),
  }).success, true);
});

test('account validation rejects blank names, excessive lengths and unsupported languages at their field', () => {
  for (const [patch, field, message] of [
    [{ first_name: '  ' }, 'first_name', 'accountEdit.nameRequired'],
    [{ last_name: '' }, 'last_name', 'accountEdit.nameRequired'],
    [{ first_name: 'a'.repeat(101) }, 'first_name', 'accountEdit.nameMax'],
    [{ last_name: 'b'.repeat(101) }, 'last_name', 'accountEdit.nameMax'],
    [{ phone: '1'.repeat(33) }, 'phone', 'accountEdit.phoneMax'],
    [{ locale: 'de' }, 'locale', 'accountEdit.localeInvalid'],
  ]) {
    const result = accountSchema.safeParse({ ...VALUES, ...patch });
    assert.equal(result.success, false);
    assert.ok(result.error.issues.some(issue => issue.path[0] === field && issue.message === message));
  }
});

test('saving PATCHes only editable account fields, clears a blank phone, and returns the full server user', async () => {
  const fake = scriptApi([[200, USER]]);
  assert.deepEqual(await accountApi.update({
    ...VALUES, first_name: ' Aida ', last_name: ' Alimova ', phone: '  ', email: 'ignored@example.com',
  }), USER);
  assert.deepEqual(fake.calls, [{ method: 'PATCH', path: '/users/me', body: {
    first_name: 'Aida', last_name: 'Alimova', phone: null, locale: 'kk',
  } }]);
});

test('saving retains a supplied phone and forwards the session cancellation signal', async () => {
  const controller = new AbortController();
  const fake = scriptApi([[200, { ...USER, phone: '+77001234567', locale: 'en' }]]);
  await accountApi.update({ ...VALUES, phone: ' +77001234567 ', locale: 'en' }, controller.signal);
  assert.equal(fake.calls[0].body.phone, '+77001234567');
  assert.equal(fake.calls[0].body.locale, 'en');
  assert.equal(globalThis.__accountRequestInit.signal, controller.signal);
});

test('save errors propagate so the form can keep the entered values and show server validation', async () => {
  scriptApi([[422, { detail: 'Invalid phone' }]]);
  await assert.rejects(accountApi.update(VALUES), error => error.status === 422);
});
