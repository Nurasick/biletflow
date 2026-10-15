import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Exercise the feature's TypeScript modules, as in the existing auth/profile tests.
async function moduleUrl(path, replacements = {}) {
  let source = await readFile(new URL(path, import.meta.url), 'utf8');
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`;
}

const dateTimeUrl = await moduleUrl('../src/features/Organizer/model/eventDateTime.ts');
const schemaUrl = await moduleUrl('../src/features/Organizer/model/eventSchema.ts', {
  '"zod"': JSON.stringify(import.meta.resolve('zod')),
  '"./eventDateTime"': JSON.stringify(dateTimeUrl),
});
const imageUrl = await moduleUrl('../src/features/Organizer/model/eventImages.ts', {
  '"./eventSchema"': JSON.stringify(schemaUrl),
});
const sessionUrl = `data:text/javascript;base64,${Buffer.from(`
  export const session = { id: 1, role: 'organizer' };
  export const organizerApi = { currentSession: () => session };
`).toString('base64')}`;
const apiUrl = await moduleUrl('../src/shared/api/organizerEvents.ts', {
  '"../../features/Organizer/model/eventSchema"': JSON.stringify(schemaUrl),
  '"./organizer"': JSON.stringify(sessionUrl),
});

const { parseLocalDateTime, resolveEventDateTime, isEventTimeZone } = await import(dateTimeUrl);
const { emptyOrganizerEvent, eventSchema, MAX_IMAGE_BYTES } = await import(schemaUrl);
const { validateEventImageFiles, readEventImage } = await import(imageUrl);
const { createOrganizerEventApi, EVENT_DEMO_ERRORS } = await import(apiUrl);
const { session } = await import(sessionUrl);

const validDraft = () => ({
  ...emptyOrganizerEvent(),
  title: 'Indie Night', description: 'An evening of live music.', category: 'concert',
  venueName: 'Music Hall', venueAddress: '56 Dostyk Ave, Almaty',
  startsAt: '2027-04-18T19:00', endsAt: '2027-04-18T22:00',
  registrationOpensAt: '2027-04-01T09:00', registrationClosesAt: '2027-04-18T18:00',
  capacity: '250', visibility: 'unlisted',
});

const errorAt = (patch, field, message) => {
  const result = eventSchema.safeParse({ ...validDraft(), ...patch });
  assert.equal(result.success, false);
  assert.ok(result.error.issues.some((issue) => issue.path[0] === field && issue.message === message),
    JSON.stringify(result.error.issues));
};

test('event details are trimmed and optional images, capacity and registration boundaries are accepted', () => {
  const parsed = eventSchema.parse({ ...validDraft(), title: ' Indie Night ', description: ' Music. ', capacity: ' ' });
  assert.equal(parsed.title, 'Indie Night');
  assert.equal(parsed.description, 'Music.');
  assert.equal(parsed.capacity, '');
  for (const registration of [
    { registrationOpensAt: '', registrationClosesAt: '' },
    { registrationOpensAt: '' }, { registrationClosesAt: '' },
    { registrationClosesAt: validDraft().startsAt },
  ]) assert.equal(eventSchema.safeParse({ ...validDraft(), ...registration }).success, true);
});

test('required fields, lengths, category, capacity and visibility are validated', () => {
  for (const [patch, field, message] of [
    [{ title: ' ' }, 'title', 'validation.eventTitle'],
    [{ title: 'x'.repeat(301) }, 'title', 'validation.eventTitleMax'],
    [{ description: ' ' }, 'description', 'validation.eventDescription'],
    [{ description: 'x'.repeat(10001) }, 'description', 'validation.eventDescriptionMax'],
    [{ venueName: '' }, 'venueName', 'validation.eventVenue'],
    [{ venueName: 'x'.repeat(301) }, 'venueName', 'validation.eventVenueMax'],
    [{ venueAddress: '' }, 'venueAddress', 'validation.eventAddress'],
    [{ venueAddress: 'x'.repeat(2001) }, 'venueAddress', 'validation.eventAddressMax'],
    [{ category: 'invalid' }, 'category', 'validation.eventCategory'],
    [{ visibility: 'invalid' }, 'visibility', 'validation.eventVisibility'],
    [{ timeZone: '+05:00' }, 'timeZone', 'validation.eventTimeZone'],
    [{ timeZone: 'Mars/Olympus' }, 'timeZone', 'validation.eventTimeZone'],
  ]) errorAt(patch, field, message);
  for (const capacity of ['0', '-1', '1.5', '1e3', 'NaN', '2147483648', '20 people']) {
    errorAt({ capacity }, 'capacity', 'validation.eventCapacity');
  }
  assert.equal(eventSchema.safeParse({ ...validDraft(), capacity: '2147483647' }).success, true);
  for (const visibility of ['public', 'unlisted', 'private']) {
    assert.equal(eventSchema.safeParse({ ...validDraft(), visibility }).success, true);
  }
});

test('invalid calendar dates, missing times, reversed event and registration windows fail at the relevant field', () => {
  for (const value of ['', '2027-02-29T19:00', '2027-04-18', '2027-04-18T25:00', '0000-01-01T00:00']) {
    assert.equal(parseLocalDateTime(value), null);
    errorAt({ startsAt: value }, 'startsAt', 'validation.eventDateTime');
  }
  errorAt({ endsAt: validDraft().startsAt }, 'endsAt', 'validation.eventEndOrder');
  errorAt({ endsAt: '2027-04-17T22:00' }, 'endsAt', 'validation.eventEndOrder');
  errorAt({ registrationClosesAt: validDraft().registrationOpensAt }, 'registrationClosesAt', 'validation.eventRegistrationOrder');
  errorAt({ registrationClosesAt: '2027-04-19T00:00' }, 'registrationClosesAt', 'validation.eventRegistrationAfterStart');
  errorAt({ registrationOpensAt: '2027-04-19T00:00' }, 'registrationOpensAt', 'validation.eventRegistrationAfterStart');
});

test('time zone resolution uses the selected IANA zone, including fractional offsets and DST', () => {
  assert.equal(isEventTimeZone('UTC'), true);
  assert.equal(isEventTimeZone('Asia/Almaty'), true);
  assert.deepEqual(resolveEventDateTime('2027-04-18T19:00', 'Asia/Almaty'), [Date.parse('2027-04-18T14:00:00Z')]);
  assert.deepEqual(resolveEventDateTime('2027-04-18T19:00', 'Asia/Kathmandu'), [Date.parse('2027-04-18T13:15:00Z')]);
  assert.deepEqual(resolveEventDateTime('2027-04-18T19:00', 'UTC'), [Date.parse('2027-04-18T19:00:00Z')]);
  assert.deepEqual(resolveEventDateTime('2027-03-14T02:30', 'America/New_York'), []);
  assert.deepEqual(resolveEventDateTime('2027-11-07T01:30', 'America/New_York'), [
    Date.parse('2027-11-07T05:30:00Z'), Date.parse('2027-11-07T06:30:00Z'),
  ]);
  errorAt({ timeZone: 'America/New_York', startsAt: '2027-03-14T02:30' }, 'startsAt', 'validation.eventDateNonexistent');
  errorAt({ timeZone: 'America/New_York', registrationOpensAt: '2026-11-01T01:30' }, 'registrationOpensAt', 'validation.eventDateAmbiguous');
});

test('image selection rejects unsupported, empty, oversized and excessive files', () => {
  const file = { type: 'image/png', size: 100 };
  assert.equal(validateEventImageFiles([file], 0), null);
  assert.equal(validateEventImageFiles([file], 4), null);
  assert.equal(validateEventImageFiles([file], 5), 'validation.eventImageCount');
  assert.equal(validateEventImageFiles(Array(6).fill(file), 0), 'validation.eventImageCount');
  assert.equal(validateEventImageFiles([{ ...file, type: 'image/svg+xml' }], 0), 'validation.eventImageType');
  assert.equal(validateEventImageFiles([{ ...file, size: MAX_IMAGE_BYTES + 1 }], 0), 'validation.eventImageSize');
  assert.equal(validateEventImageFiles([{ ...file, size: 0 }], 0), 'validation.eventImageSize');
  assert.equal(validateEventImageFiles([{ ...file, size: MAX_IMAGE_BYTES }], 0), null);
  errorAt({ images: Array(6).fill({ id: 'id', name: 'image', dataUrl: 'data:image/png;base64,AAAA' }) }, 'images', 'validation.eventImageCount');
  assert.equal(eventSchema.safeParse({ ...validDraft(), images: [{ id: 'id', name: 'image', dataUrl: 'javascript:alert(1)' }] }).success, false);
});

test('image decoding failures are surfaced, including files that only claim to be images', async () => {
  const originalReader = globalThis.FileReader;
  const originalImage = globalThis.Image;
  try {
    globalThis.FileReader = class {
      readAsDataURL() { this.result = 'data:image/png;base64,AAAA'; this.onload(); }
    };
    globalThis.Image = class { set src(_) { this.onerror(); } };
    await assert.rejects(readEventImage({ name: 'invalid.png' }));
    globalThis.FileReader = class { readAsDataURL() { this.onerror(); } };
    await assert.rejects(readEventImage({ name: 'unreadable.png' }));
  } finally {
    globalThis.FileReader = originalReader;
    globalThis.Image = originalImage;
  }
});

test('drafts persist normalized details, image order and optional boundaries per organizer', async () => {
  const records = new Map();
  const storage = {
    read: async (key) => structuredClone(records.get(key)),
    write: async (key, values) => { records.set(key, structuredClone(values)); },
  };
  const api = createOrganizerEventApi(storage);
  assert.deepEqual(await api.getDraft(1), emptyOrganizerEvent());
  const draft = { ...validDraft(), title: '  Indie Night ', images: [
    { id: 'cover', name: 'cover.png', dataUrl: 'data:image/png;base64,AAAA' },
    { id: 'gallery', name: 'gallery.png', dataUrl: 'data:image/png;base64,BBBB' },
  ] };
  const result = await api.saveDraft(1, draft);
  assert.equal(result.title, 'Indie Night');
  assert.equal(draft.title, '  Indie Night ');
  assert.deepEqual(await createOrganizerEventApi(storage).getDraft(1), result);
  assert.deepEqual(result.images.map((image) => image.id), ['cover', 'gallery']);
  await assert.rejects(api.getDraft(2), /organizerEvent.accessError/);
  session.role = 'attendee';
  try {
    await assert.rejects(api.getDraft(1), /organizerEvent.accessError/);
    await assert.rejects(api.saveDraft(1, draft), /organizerEvent.accessError/);
  } finally { session.role = 'organizer'; }
});

test('storage failures preserve the previous draft and the submitted values, and allow retry', async () => {
  let stored = validDraft();
  let fail = true;
  const api = createOrganizerEventApi({
    read: async () => { if (fail) throw new Error('Storage blocked'); return structuredClone(stored); },
    write: async (_, values) => { if (fail) throw new Error('Quota exceeded'); stored = structuredClone(values); },
  });
  const changes = { ...validDraft(), title: 'Updated title' };
  await assert.rejects(api.getDraft(1), /organizerEvent.loadError/);
  await assert.rejects(api.saveDraft(1, changes), /organizerEvent.saveError/);
  assert.equal(stored.title, 'Indie Night');
  assert.equal(changes.title, 'Updated title');
  fail = false;
  assert.deepEqual(await api.saveDraft(1, changes), changes);
  assert.deepEqual(await api.getDraft(1), changes);
});

test('corrupted saved data is reported without overwriting it, and demo errors can be retried', async () => {
  const api = createOrganizerEventApi({ read: async () => ({ title: 'corrupt' }), write: async () => assert.fail('must not overwrite') });
  await assert.rejects(api.getDraft(1), /organizerEvent.loadError/);
  const validApi = createOrganizerEventApi({ read: async () => validDraft(), write: async () => {} });
  EVENT_DEMO_ERRORS.load = true;
  EVENT_DEMO_ERRORS.save = true;
  try {
    await assert.rejects(validApi.getDraft(1), /organizerEvent.loadError/);
    await assert.rejects(validApi.saveDraft(1, validDraft()), /organizerEvent.saveError/);
  } finally {
    EVENT_DEMO_ERRORS.load = false;
    EVENT_DEMO_ERRORS.save = false;
  }
  assert.deepEqual(await validApi.getDraft(1), validDraft());
  assert.deepEqual(await validApi.saveDraft(1, validDraft()), validDraft());
});
