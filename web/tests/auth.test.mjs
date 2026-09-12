import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

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
    const [status, body] = next;
    return new Response(status === 204 ? null : JSON.stringify(body), { status });
  };
  const { outputText } = ts.transpileModule(
    source.replace('import.meta.env.VITE_API_URL', 'undefined'),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
  );
  const api = await import(`data:text/javascript;base64,${Buffer.from(outputText + `\n//# sourceURL=auth-test-${moduleId++}.js`).toString('base64')}`);
  return { ...api, calls, storage };
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
