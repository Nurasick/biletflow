import assert from 'node:assert/strict';
import test from 'node:test';

import { fakeAuthUrl, moduleUrl, scriptApi } from './harness.mjs';

const schemaUrl = await moduleUrl('../src/features/Organizer/model/profileSchema.ts', {
  '"zod"': JSON.stringify(import.meta.resolve('zod')),
});
const apiUrl = await moduleUrl('../src/shared/api/organizer.ts', {
  '"../../features/Organizer/model/profileSchema"': JSON.stringify(schemaUrl),
  '"./auth"': JSON.stringify(fakeAuthUrl),
});
const { profileSchema } = await import(schemaUrl);
const { organizerApi } = await import(apiUrl);

const PROFILE = {
  displayName: 'KBTU Music Club',
  contactEmail: 'music.club@example.com',
  contactPhone: '+7 (700) 123-45-67',
  description: 'Live music in Almaty.',
  payoutProvider: '',
  payoutReference: '',
};

test('contact validation trims names, normalizes email, and allows optional fields', () => {
  const values = profileSchema.parse({ ...PROFILE, displayName: ' Club ', contactEmail: ' CLUB@EXAMPLE.COM ', contactPhone: '' });
  assert.equal(values.displayName, 'Club');
  assert.equal(values.contactEmail, 'club@example.com');
  assert.equal(values.contactPhone, '');
  for (const invalid of [
    { displayName: '  ' }, { displayName: 'a'.repeat(201) },
    { contactEmail: 'not-an-email' }, { contactPhone: '123' },
    { contactPhone: '+7700abc1234' }, { description: 'a'.repeat(2001) },
  ]) assert.equal(profileSchema.safeParse({ ...PROFILE, ...invalid }).success, false);
});

test('payout simulation requires a provider and demo reference together', () => {
  assert.equal(profileSchema.safeParse({ ...PROFILE, payoutProvider: 'sandbox_bank' }).success, false);
  assert.equal(profileSchema.safeParse({ ...PROFILE, payoutReference: 'demo_abc' }).success, false);
  assert.equal(profileSchema.safeParse({ ...PROFILE, payoutProvider: 'sandbox_bank', payoutReference: 'demo_abc' }).success, true);
});

test('no profile yet (404) is an empty form prefilled with the account email', async () => {
  const fake = scriptApi([[404, { detail: 'No organizer profile yet' }]]);
  const values = await organizerApi.getProfile('me@example.com');
  assert.equal(values.contactEmail, 'me@example.com');
  assert.equal(values.displayName, '');
  assert.deepEqual(fake.calls.map((c) => [c.method, c.path]), [['GET', '/organizer/profile']]);
});

test('saving sends the API field names, empty optionals as null, and maps the reply back', async () => {
  const reply = {
    id: 3, display_name: 'Club', contact_email: 'club@example.com', contact_phone: null, description: null,
    verification_status: 'unverified',
    payout_account: { provider: 'sandbox_wallet', external_account_ref: 'demo_wallet1', status: 'active', is_simulated: true },
  };
  const fake = scriptApi([[200, reply]]);
  const saved = await organizerApi.saveProfile({
    ...PROFILE, displayName: 'Club', contactEmail: 'club@example.com', contactPhone: '', description: '',
    payoutProvider: 'sandbox_wallet', payoutReference: 'demo_wallet1',
  });
  assert.deepEqual(fake.calls[0].body, {
    display_name: 'Club', contact_email: 'club@example.com', contact_phone: null, description: null,
    payout_provider: 'sandbox_wallet', payout_reference: 'demo_wallet1',
  });
  assert.equal(saved.payoutProvider, 'sandbox_wallet');
  assert.equal(saved.contactPhone, '');
});

test('other failures are not mistaken for "no profile"', async () => {
  scriptApi([[500, { detail: 'boom' }]]);
  await assert.rejects(organizerApi.getProfile(''), (error) => error.status === 500);
});
