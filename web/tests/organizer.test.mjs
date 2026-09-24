import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Like the auth tests, exercise the actual TypeScript modules without a browser.
async function moduleUrl(path, replacements = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}

const schemaUrl = await moduleUrl('../src/features/Organizer/model/profileSchema.ts', {
  '"zod"': JSON.stringify(import.meta.resolve('zod')),
});
const dataUrl = await moduleUrl('../src/features/Organizer/model/dummyData.ts');
const apiUrl = await moduleUrl('../src/shared/api/organizer.ts', {
  '"../../features/Organizer/model/profileSchema"': JSON.stringify(schemaUrl),
  '"../../features/Organizer/model/dummyData"': JSON.stringify(dataUrl),
});
const { profileSchema } = await import(schemaUrl);
const { DUMMY_PROFILE, DUMMY_SESSION, DUMMY_ERRORS } = await import(dataUrl);
const { organizerApi } = await import(apiUrl);

test('contact validation trims names, normalizes email, and allows optional fields', () => {
  const values = profileSchema.parse({ ...DUMMY_PROFILE, displayName: ' Club ', contactEmail: ' CLUB@EXAMPLE.COM ', contactPhone: '' });
  assert.equal(values.displayName, 'Club');
  assert.equal(values.contactEmail, 'club@example.com');
  assert.equal(values.contactPhone, '');
  for (const invalid of [
    { displayName: '  ' }, { displayName: 'a'.repeat(201) },
    { contactEmail: 'not-an-email' }, { contactPhone: '123' },
    { contactPhone: '+7700abc1234' }, { description: 'a'.repeat(2001) },
  ]) assert.equal(profileSchema.safeParse({ ...DUMMY_PROFILE, ...invalid }).success, false);
});

test('payout simulation requires a provider and demo reference together', () => {
  for (const invalid of [
    { payoutProvider: 'sandbox_bank' }, { payoutReference: 'demo_club' },
    { payoutProvider: 'sandbox_bank', payoutReference: 'KZ123456789' },
    { payoutProvider: 'real_bank', payoutReference: 'demo_club' },
  ]) assert.equal(profileSchema.safeParse({ ...DUMMY_PROFILE, ...invalid }).success, false);
  assert.equal(profileSchema.safeParse({ ...DUMMY_PROFILE, payoutProvider: 'sandbox_wallet', payoutReference: 'demo_club' }).success, true);
});

test('demo API persists contact and payout settings and supports disconnecting', async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  assert.deepEqual(await organizerApi.getProfile(1), DUMMY_PROFILE);
  const changes = { ...DUMMY_PROFILE, displayName: 'Updated club', payoutProvider: 'sandbox_bank', payoutReference: 'demo_updated' };
  await organizerApi.saveProfile(1, changes);
  assert.deepEqual(await organizerApi.getProfile(1), changes);
  const disconnected = { ...changes, payoutProvider: '', payoutReference: '' };
  await organizerApi.saveProfile(1, disconnected);
  assert.deepEqual(await organizerApi.getProfile(1), disconnected);
});

test('demo API denies other users and attendees', async () => {
  await assert.rejects(organizerApi.getProfile(2), /Only organizers/);
  await assert.rejects(organizerApi.saveProfile(2, DUMMY_PROFILE), /Only organizers/);
  DUMMY_SESSION.role = 'attendee';
  try {
    await assert.rejects(organizerApi.getProfile(1), /Only organizers/);
    await assert.rejects(organizerApi.saveProfile(1, DUMMY_PROFILE), /Only organizers/);
  } finally {
    DUMMY_SESSION.role = 'organizer';
  }
});

test('load and save errors reject, without reporting a successful save', async () => {
  DUMMY_ERRORS.load = true;
  DUMMY_ERRORS.save = true;
  try {
    await assert.rejects(organizerApi.getProfile(1), /Couldn't load/);
    await assert.rejects(organizerApi.saveProfile(1, DUMMY_PROFILE), /Couldn't save/);
  } finally {
    DUMMY_ERRORS.load = false;
    DUMMY_ERRORS.save = false;
  }
  globalThis.localStorage = {
    getItem: () => { throw new Error('Storage denied'); },
    setItem: () => { throw new Error('Storage full'); },
  };
  await assert.rejects(organizerApi.getProfile(1), /Couldn't read/);
  await assert.rejects(organizerApi.saveProfile(1, DUMMY_PROFILE), /Couldn't save to this browser/);
});
