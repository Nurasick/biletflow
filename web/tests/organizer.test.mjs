import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

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

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('organizerProfileKeys exposes payouts key, saveProfile invalidates it, and PayoutsPanel gates the query on record.data', async () => {
  const reactQueryStubUrl = dataUrl(`
    export const useQueryClient = () => globalThis.__rq.queryClient;
    export const useQuery = (options) => {
      globalThis.__rq.queries.push(options);
      return globalThis.__rq.queryResponse(options);
    };
    export const useMutation = (options) => {
      globalThis.__rq.mutations.push(options);
      return options;
    };
  `);
  const authKeysStubUrl = dataUrl(`export const authKeys = { me: ['auth', 'me'] };`);
  const profileHookUrl = await moduleUrl('../src/features/Organizer/model/useOrganizerProfile.ts', {
    '"@tanstack/react-query"': JSON.stringify(reactQueryStubUrl),
    '"../../../hooks/useAuth"': JSON.stringify(authKeysStubUrl),
    '"../../../shared/api/organizer"': JSON.stringify(apiUrl),
  });
  const { organizerProfileKeys, useOrganizerProfile } = await import(profileHookUrl);

  assert.deepEqual(organizerProfileKeys.profile(7), ['organizer', 'profile', 7]);
  assert.deepEqual(organizerProfileKeys.record(7), ['organizer', 'profile-record', 7]);
  assert.deepEqual(organizerProfileKeys.payouts(7), ['organizer', 'payouts', 7]);

  const invalidated = [];
  const cached = [];
  globalThis.__rq = {
    queries: [],
    mutations: [],
    queryResponse: () => ({ data: undefined }),
    queryClient: {
      setQueryData: (key, value) => cached.push([key, value]),
      invalidateQueries: async (filter) => invalidated.push(filter.queryKey),
    },
  };

  const { saveProfile } = useOrganizerProfile(7, 'me@example.com');
  await saveProfile.onSuccess(PROFILE);
  assert.deepEqual(cached, [[['organizer', 'profile', 7], PROFILE]]);
  assert.deepEqual(invalidated, [
    ['auth', 'me'],
    ['organizer', 'profile-record', 7],
    ['organizer', 'payouts', 7],
  ]);

  // Transpile PayoutsPanel.tsx with ReactJSX to verify its live queryKey & enabled gating.
  let panelSource = await readFile(new URL('../src/features/Organizer/ui/PayoutsPanel.tsx', import.meta.url), 'utf8');
  const stubComponent = dataUrl(`export const Landmark = () => null; export const ReportError = () => null; export const ReportLoading = () => null; export const ReportRefresh = () => null;`);
  const replacements = {
    '"@tanstack/react-query"': JSON.stringify(reactQueryStubUrl),
    '"lucide-react"': JSON.stringify(stubComponent),
    '"react-i18next"': JSON.stringify(dataUrl(`export const useTranslation = () => ({ t: (k) => k });`)),
    '"../../../i18n/useLocale"': JSON.stringify(dataUrl(`export const useLocale = () => 'en-US';`)),
    '"../../../shared/api/organizer"': JSON.stringify(apiUrl),
    '"../../../shared/lib/formatPrice"': JSON.stringify(dataUrl(`export const formatMinorCurrency = (n) => String(n);`)),
    '"../model/useOrganizerProfile"': JSON.stringify(profileHookUrl),
    '"./ReportControls"': JSON.stringify(stubComponent),
  };
  for (const [from, to] of Object.entries(replacements)) panelSource = panelSource.replaceAll(from, to);
  const { outputText } = ts.transpileModule(panelSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const panelUrl = dataUrl(outputText.replaceAll('"react/jsx-runtime"', JSON.stringify(import.meta.resolve('react/jsx-runtime'))));
  const { PayoutsPanel } = await import(panelUrl);

  // Onboarding (no profile record yet): payouts query must be disabled and keyed consistently.
  globalThis.__rq.queries = [];
  globalThis.__rq.queryResponse = () => ({ data: null, isPending: false, isFetching: false, isError: false, refetch: () => {} });
  assert.equal(PayoutsPanel({ userId: 7 }), null);
  assert.equal(globalThis.__rq.queries.length, 2);
  assert.deepEqual(globalThis.__rq.queries[0].queryKey, organizerProfileKeys.record(7));
  assert.deepEqual(globalThis.__rq.queries[1].queryKey, organizerProfileKeys.payouts(7));
  assert.equal(globalThis.__rq.queries[1].enabled, false);

  // After profile exists: payouts query becomes enabled with the exact invalidated query key.
  globalThis.__rq.queries = [];
  globalThis.__rq.queryResponse = (options) => options.queryKey[1] === 'profile-record'
    ? { data: { id: 3, verification_status: 'unverified', payout_account: null } }
    : { data: [], isPending: false, isFetching: false, isError: false, refetch: () => {} };
  assert.notEqual(PayoutsPanel({ userId: 7 }), null);
  assert.equal(globalThis.__rq.queries.length, 2);
  assert.deepEqual(globalThis.__rq.queries[1].queryKey, organizerProfileKeys.payouts(7));
  assert.equal(globalThis.__rq.queries[1].enabled, true);
});
